'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 渲染进程不接触 fs / path，只能调用下面这几个白名单方法
contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  openTxt: () => ipcRenderer.invoke('dialog:openTxt'),
  saveTxt: (defaultName, content) => ipcRenderer.invoke('dialog:saveTxt', defaultName, content),
  saveAll: (files) => ipcRenderer.invoke('dialog:saveAll', files),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
});
