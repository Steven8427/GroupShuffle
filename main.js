'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');

// 与渲染进程共用同一份文案表，加语言只改那一个文件
const i18n = require('./renderer/i18n.js');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// Windows 记事本 / Excel 友好：UTF-8 BOM + CRLF 行尾
const BOM = '﻿';
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

let win = null;
let tray = null;
let confirmedQuit = false;

// 原生对话框与托盘的文案都在字典的 main.* 命名空间下
const T = (key, vars) => i18n.t('main.' + key, vars);

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // 立刻显示，不等渲染进程画完第一帧。Electron 的启动开销大头是运行时自身，
    // 压不下去；但等 ready-to-show 会把「有反应」这件事又推后约 270ms。
    // 先显示带底色的空窗口，用户能立刻看到程序起来了
    show: true,
    title: 'GroupShuffle',
    icon: ICON_PATH,
    // 跟着系统深浅色走。写死浅色的话，深色主题下这一瞬间会闪一下白
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161a' : '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 最小化收进系统托盘（右下角通知区域），而不是留在任务栏
  win.on('minimize', (event) => {
    event.preventDefault();
    win.hide();
  });

  // 关掉窗口前二次确认；托盘「退出」和系统关机走 before-quit，不重复问
  win.on('close', (event) => {
    if (confirmedQuit) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [T('closeConfirm'), T('cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: T('closeTitle'),
      message: T('closeMsg'),
      detail: T('closeDetail'),
    });
    if (choice === 0) {
      confirmedQuit = true;
      win.close();
    }
  });

  // 排查问题时用 RG_DEBUG=1 启动，可把渲染进程的报错转发到终端
  if (process.env.RG_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`);
    });
    win.webContents.on('did-finish-load', () => console.log('[renderer] loaded'));
  }

  // 外部链接交给系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: T('trayShow'), click: showWindow },
    { type: 'separator' },
    { label: T('trayQuit'), click: () => app.quit() },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('GroupShuffle');
  buildTrayMenu();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { confirmedQuit = true; });

app.on('quit', () => {
  if (tray) { tray.destroy(); tray = null; } // 不留幽灵图标
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 文本落盘统一走这里：补 BOM，行尾归一为 CRLF
function toFileBuffer(content) {
  const normalized = String(content).replace(/\r\n|\r|\n/g, '\r\n');
  return Buffer.from(BOM + normalized, 'utf8');
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

ipcMain.handle('app:setLang', (_evt, next) => {
  const applied = i18n.setLang(next);
  buildTrayMenu(); // 托盘菜单是提前建好的，语言变了要重建
  return applied;
});

ipcMain.handle('dialog:openTxt', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: T('openTitle'),
    properties: ['openFile'],
    filters: [
      { name: T('filterText'), extensions: ['txt', 'csv', 'log'] },
      { name: T('filterAll'), extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const filePath = res.filePaths[0];
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_IMPORT_BYTES) {
      return { error: T('tooLarge', { mb: (stat.size / 1048576).toFixed(0) }) };
    }
    const buf = await fsp.readFile(filePath);
    return { text: stripBom(buf.toString('utf8')), path: filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:saveTxt', async (_evt, defaultName, content) => {
  const res = await dialog.showSaveDialog(win, {
    title: T('saveTitle'),
    defaultPath: defaultName,
    filters: [{ name: T('filterText'), extensions: ['txt'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    await fsp.writeFile(res.filePath, toFileBuffer(content));
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:saveAll', async (_evt, files) => {
  const res = await dialog.showOpenDialog(win, {
    title: T('dirTitle'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: T('dirButton'),
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const dir = res.filePaths[0];
  try {
    const existing = (await fsp.readdir(dir)).filter((n) => /^group-\d+\.txt$/i.test(n));
    if (existing.length) {
      const confirm = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [T('overwrite'), T('cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: T('overwriteMsg', { n: existing.length }),
        detail: T('overwriteDetail'),
      });
      if (confirm.response !== 0) return { canceled: true };
    }

    let written = 0;
    for (const file of files) {
      const safeName = path.basename(String(file.name));
      await fsp.writeFile(path.join(dir, safeName), toFileBuffer(file.content));
      written++;
    }
    return { ok: true, dir, written };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('shell:reveal', async (_evt, target) => {
  await shell.openPath(target);
});
