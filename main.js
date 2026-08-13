'use strict';

const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// Windows 记事本 / Excel 友好：UTF-8 BOM + CRLF 行尾
const BOM = '﻿';
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

let win = null;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'GroupShuffle',
    icon: ICON_PATH,
    backgroundColor: '#f5f6f8',
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
  win.once('ready-to-show', () => win.show());

  // 最小化收进系统托盘（右下角通知区域），而不是留在任务栏
  win.on('minimize', (event) => {
    event.preventDefault();
    win.hide();
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

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('GroupShuffle');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
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

ipcMain.handle('dialog:openTxt', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '选择要分组的文本文件',
    properties: ['openFile'],
    filters: [
      { name: '文本文件', extensions: ['txt', 'csv', 'log'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const filePath = res.filePaths[0];
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_IMPORT_BYTES) {
      return { error: `文件过大（${(stat.size / 1048576).toFixed(0)} MB），请拆分后再导入` };
    }
    const buf = await fsp.readFile(filePath);
    return { text: stripBom(buf.toString('utf8')), path: filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('dialog:saveTxt', async (_evt, defaultName, content) => {
  const res = await dialog.showSaveDialog(win, {
    title: '导出为 TXT',
    defaultPath: defaultName,
    filters: [{ name: '文本文件', extensions: ['txt'] }],
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
    title: '选择导出目录',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '导出到此文件夹',
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };

  const dir = res.filePaths[0];
  try {
    const existing = (await fsp.readdir(dir)).filter((n) => /^group-\d+\.txt$/i.test(n));
    if (existing.length) {
      const confirm = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['覆盖', '取消'],
        defaultId: 1,
        cancelId: 1,
        message: `该文件夹已有 ${existing.length} 个 group-*.txt 文件`,
        detail: '继续将覆盖同名文件。',
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
