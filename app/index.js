/* eslint-disable func-names */
import log from 'electron-log';
import os from 'os';
import fs from 'fs';
import React, { Fragment } from 'react';
import { render } from 'react-dom';
import { AppContainer as ReactHotAppContainer } from 'react-hot-loader';
import { ipcRenderer, remote } from 'electron';
import { WalletBackend, LogLevel } from 'turtlecoin-wallet-backend';
import clipboardy from 'clipboardy';
import EventEmitter from 'events';
import Root from './containers/Root';
import { configureStore, history } from './store/configureStore';
import './app.global.css';
import WalletSession from './wallet/session';
import iConfig from './constants/config';

export const eventEmitter = new EventEmitter();
// FIX
eventEmitter.setMaxListeners(2);

export let config = iConfig;

log.debug(`Proton wallet started...`);

const homedir = os.homedir();

export const directories = [
  `${homedir}/.protonwallet`,
  `${homedir}/.protonwallet/logs`,
  `${homedir}/.protonwallet/wallets`
];

const [programDirectory, logDirectory, walletDirectory] = directories;

if (config.walletFile === '') {
  config.walletFile = `${walletDirectory}/default.wallet`;
}

if (!fs.existsSync(`${programDirectory}/config.json`)) {
  fs.writeFile(
    `${programDirectory}/config.json`,
    JSON.stringify(config, null, 4),
    err => {
      if (err) throw err;
      log.debug('Config not detected, wrote internal config to disk.');
    }
  );
} else {
  log.debug(
    "Config file found in user's home directory, defaulting to local config..."
  );
  const rawUserConfig = fs.readFileSync(`${programDirectory}/config.json`);
  config = JSON.parse(rawUserConfig);
}

log.debug('Checking if program directories are present...');
// eslint-disable-next-line func-names
directories.forEach(function(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    log.debug(`${dir} directories not detected, creating...`);
  } else if (dir === programDirectory) {
    log.debug('Directories found. Initializing wallet session...');
  }
});

export let session = new WalletSession();

if (!session.loginFailed) {
  log.debug('Initialized wallet session ', session.address);
  startWallet();
} else {
  log.debug('Login failed, redirecting to login...');
}

// eslint-disable-next-line func-names
ipcRenderer.on('handleSave', function(evt, route) {
  const saved = session.saveWallet(config.walletFile);
  if (saved) {
    remote.dialog.showMessageBox(null, {
      type: 'info',
      buttons: ['OK'],
      title: 'Saved!',
      message: 'The wallet was saved successfully.'
    });
  } else {
    remote.dialog.showMessageBox(null, {
      type: 'error',
      buttons: ['OK'],
      title: 'Error!',
      message:
        'The wallet was not saved successfully. Check directory permissions and try again.'
    });
  }
});

ipcRenderer.on('handleSaveAs', function(evt, route) {
  const savePath = remote.dialog.showSaveDialog();
  if (savePath === undefined) {
    return;
  }
  session.saveWallet(savePath);
  remote.dialog.showMessageBox(null, {
    type: 'info',
    buttons: ['OK'],
    title: 'Saved!',
    message: 'Your wallet was saved successfully.'
  });
});

ipcRenderer.on('handleOpen', function(evt, route) {
  const getPaths = remote.dialog.showOpenDialog();
  if (getPaths === undefined) {
    return;
  }
  const [wallet, error] = WalletBackend.openWalletFromFile(
    session.daemon,
    getPaths[0],
    ''
  );
  if (error && error.errorCode !== 5) {
    log.debug(`Failed to open wallet: ${error.toString()}`);
    remote.dialog.showMessageBox(null, {
      type: 'error',
      buttons: ['OK'],
      title: 'Error opening wallet!',
      message: error.toString()
    });
    return;
  }
  if (error !== undefined) {
    if (error.errorCode === 5) {
      log.debug('Login to wallet failed, firing event...');
      eventEmitter.emit('loginFailed');
    }
  }
  const selectedPath = getPaths[0];
  const savedSuccessfully = session.handleWalletOpen(selectedPath);
  if (savedSuccessfully === true) {
    session = null;
    session = new WalletSession();
    startWallet();
    eventEmitter.emit('openNewWallet');
  } else {
    remote.dialog.showMessageBox(null, {
      type: 'error',
      buttons: ['OK'],
      title: 'Error opening wallet!',
      message: 'The wallet was not opened successfully. Try again.'
    });
  }
});

eventEmitter.on('initializeNewSession', function(password) {
  session = null;
  session = new WalletSession(password);
  startWallet();
  eventEmitter.emit('openNewWallet');
});

ipcRenderer.on('handleNew', function(evt, route) {
  const userSelection = remote.dialog.showMessageBox(null, {
    type: 'question',
    buttons: ['Cancel', 'OK'],
    title: 'New Wallet',
    message: 'Press OK to select a location for your new wallet.'
  });
  if (userSelection !== 1) {
    return;
  }
  const savePath = remote.dialog.showSaveDialog();
  if (savePath === undefined) {
    return;
  }
  const createdSuccessfuly = session.handleNewWallet(savePath);
  if (createdSuccessfuly === false) {
    remote.dialog.showMessageBox(null, {
      type: 'error',
      buttons: ['OK'],
      title: 'Error saving wallet!',
      message:
        'The wallet was not created successfully. Check your directory permissions and try again.'
    });
  } else {
    remote.dialog.showMessageBox(null, {
      type: 'info',
      buttons: ['OK'],
      title: 'Created!',
      message:
        'Your new wallet was created successfully. Go to Wallet > Password and add a password to the wallet if desired.'
    });
    const savedSuccessfully = session.handleWalletOpen(savePath);
    if (savedSuccessfully === true) {
      session = null;
      session = new WalletSession();
      startWallet();
      eventEmitter.emit('openNewWallet');
    } else {
      remote.dialog.showMessageBox(null, {
        type: 'error',
        buttons: ['OK'],
        title: 'Error opening wallet!',
        message: 'The wallet was not opened successfully. Try again.'
      });
    }
  }
});

ipcRenderer.on('handleBackup', function(evt, route) {
  const publicAddress = session.wallet.getPrimaryAddress();
  const [
    privateSpendKey,
    privateViewKey
  ] = session.wallet.getPrimaryAddressPrivateKeys();
  const [mnemonicSeed, err] = session.wallet.getMnemonicSeed();
  log.debug(err);

  const msg =
    // eslint-disable-next-line prefer-template
    publicAddress +
    `\n\nPrivate Spend Key:\n\n` +
    privateSpendKey +
    `\n\nPrivate View Key:\n\n` +
    privateViewKey +
    `\n\nMnemonic Seed:\n\n` +
    mnemonicSeed +
    `\n\nPlease save these keys safely and securely. \nIf you lose your keys, you will not be able to recover your funds.`;

  const userSelection = remote.dialog.showMessageBox(null, {
    type: 'info',
    buttons: ['Copy to Clipboard', 'Cancel'],
    title: 'Seed',
    message: msg
  });
  if (userSelection === 0) {
    clipboardy.writeSync(msg);
  }
});

if (config.logLevel === 'DEBUG') {
  session.wallet.setLogLevel(LogLevel.DEBUG);
  session.wallet.setLoggerCallback(
    (prettyMessage, message, level, categories) => {
      const logStream = fs.createWriteStream(
        `${logDirectory}/protonwallet.log`,
        {
          flags: 'a'
        }
      );
      logStream.write(`${prettyMessage}\n`);
    }
  );
}

const store = configureStore();

const AppContainer = process.env.PLAIN_HMR ? Fragment : ReactHotAppContainer;

async function startWallet() {
  await session.wallet.start();
  eventEmitter.emit('gotNodeFee');
}

render(
  <AppContainer>
    <Root store={store} history={history} />
  </AppContainer>,
  document.getElementById('root')
);

if (module.hot) {
  module.hot.accept('./containers/Root', () => {
    // eslint-disable-next-line global-require
    const NextRoot = require('./containers/Root').default;
    render(
      <AppContainer>
        <NextRoot store={store} history={history} />
      </AppContainer>,
      document.getElementById('root')
    );
  });
}
