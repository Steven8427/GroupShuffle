'use strict';

/**
 * 自动更新。
 *
 * 更新源用 generic（对象存储）而不是 GitHub Releases —— 因为更新源地址会烧进
 * 每一个发出去的客户端。仓库一旦转为私有，指向 GitHub Releases 的老客户端就
 * 永久失去自动更新能力，只能让用户手动重装，那正是自动更新要避免的事。
 * 地址配在 package.json 的 build.publish 里。
 *
 * 交互原则：静默到有事可做为止。
 *  - 检查中、下载中：不显示任何东西。用户没提出更新需求，进度条只是噪音
 *  - 下载完成：显示一条常驻提示，让用户自己决定什么时候重启
 *  - 检查或下载失败：只记日志。网络不通是常事，为此弹窗只会制造焦虑
 */

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FIRST_CHECK_DELAY = 5000;          // 让首屏先画完，别和启动抢资源
const RECHECK_INTERVAL = 6 * 60 * 60 * 1000; // 长期开着的实例隔一阵再看一次
const LOG_MAX_BYTES = 64 * 1024;

let updater = null;
let win = null;
let timer = null;
let logPath = null;

/** 只在装好的正式版里跑 */
function shouldRun() {
  // 开发模式没有版本可比，跑起来只会报错
  if (!app.isPackaged) return 'dev';
  // portable 版没有安装程序可执行，electron-updater 装不上去
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'portable';
  return null;
}

/**
 * 更新过程写到 userData/updater.log。
 * 打包后的 GUI 程序没有可见的控制台，出问题时用户能把这个文件发过来，
 * 否则「更新没反应」这类反馈完全无从查起。文件超过 64KB 就重来，不会无限长。
 */
function log(msg) {
  const line = new Date().toISOString() + '  ' + msg + '\n';
  if (process.env.RG_DEBUG) console.log('[updater] ' + msg);
  try {
    if (!logPath) logPath = path.join(app.getPath('userData'), 'updater.log');
    let stat = null;
    try { stat = fs.statSync(logPath); } catch (_) { /* 还没有这个文件 */ }
    if (stat && stat.size > LOG_MAX_BYTES) fs.writeFileSync(logPath, '');
    fs.appendFileSync(logPath, line);
  } catch (_) { /* 日志写不了就算了，不能因此影响主流程 */ }
}

function check() {
  if (!updater) return;
  updater.checkForUpdates().catch((err) => log('检查失败：' + err.message));
}

function init(mainWindow) {
  win = mainWindow;

  const skip = shouldRun();
  if (skip) { log('跳过（' + skip + '）'); return; }

  // 延迟 require：开发模式下这个模块根本不用加载
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;

  updater.autoDownload = true;
  // 用户不点「立即重启」也没关系，下次退出应用时会自动装上
  updater.autoInstallOnAppQuit = true;
  // 把 electron-updater 自己的输出也收进同一个日志，出问题时线索才完整
  updater.logger = { info: log, warn: (m) => log('warn: ' + m), error: (m) => log('error: ' + m), debug: () => {} };

  log('当前版本 ' + app.getVersion() + '，开始监听更新');

  updater.on('update-available', (info) => log('发现新版本 ' + info.version));
  updater.on('update-not-available', () => log('已是最新'));

  updater.on('update-downloaded', (info) => {
    const alive = win && !win.isDestroyed();
    log('已下载 ' + info.version + '，通知界面：' + (alive ? '是' : '窗口已销毁，跳过'));
    if (alive) win.webContents.send('update:ready', { version: info.version });
  });

  updater.on('error', (err) => log('出错：' + (err && err.stack ? err.stack : err)));

  timer = setTimeout(check, FIRST_CHECK_DELAY);
  setInterval(check, RECHECK_INTERVAL);
}

/**
 * 重启装更新。会触发 app.quit()，主进程的 before-quit 会把 confirmedQuit 置真，
 * 所以不会再弹「确定要退出吗」——那个确认是防误触的，这里是用户主动点的。
 */
ipcMain.handle('update:install', () => {
  if (!updater) return false;
  setImmediate(() => updater.quitAndInstall());
  return true;
});

function dispose() {
  if (timer) { clearTimeout(timer); timer = null; }
}

module.exports = { init, dispose };
