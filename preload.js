'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程不接触 fs / path，只能调用下面这几个白名单方法
contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  setLang: (lang) => ipcRenderer.invoke('app:setLang', lang),
  openTxt: () => ipcRenderer.invoke('dialog:openTxt'),
  saveTxt: (defaultName, content) => ipcRenderer.invoke('dialog:saveTxt', defaultName, content),
  saveAll: (files) => ipcRenderer.invoke('dialog:saveAll', files),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  // 新版本下载完成后主进程会通知一次，界面据此显示重启提示
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', (_e, info) => cb(info)),
  restartToUpdate: () => ipcRenderer.invoke('update:install'),
});
