// Renders the real tray-icon.ico (16px rep) onto dark+light strips.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs'), path = require('path')
const ICO = path.join(__dirname, '..', 'assets', 'images', 'tray-icon.ico')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.whenReady().then(async () => {
  const img = nativeImage.createFromPath(ICO)
  const sz = img.getSize()
  const b64 = img.resize({ width: 16, height: 16 }).toDataURL()
  const b64big = img.resize({ width: 64, height: 64 }).toDataURL()
  const win = new BrowserWindow({ width: 400, height: 200, show: false,
    webPreferences: { contextIsolation: false, offscreen: true } })
  const page = `<!DOCTYPE html><body><script>
  window.go=function(a,b){
    var c=document.createElement('canvas'); c.width=320; c.height=160
    var x=c.getContext('2d'); x.imageSmoothingEnabled=false
    x.fillStyle='#2b2b2b'; x.fillRect(0,0,320,160)
    x.fillStyle='#1c1c1c'; x.fillRect(0,10,320,32)
    x.fillStyle='#e9e9e9'; x.fillRect(0,52,320,32)
    var i=new Image(), j=new Image()
    return new Promise(function(res){
      i.onload=function(){ x.drawImage(i,40,18); x.drawImage(i,120,18); x.drawImage(i,40,60); x.drawImage(i,120,60)
        j.onload=function(){ x.drawImage(j,200,40); res(c.toDataURL('image/png')) }; j.src=b }
      i.src=a })
  }</script></body>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
  const out = await win.webContents.executeJavaScript(`window.go(${JSON.stringify(b64)},${JSON.stringify(b64big)})`)
  fs.writeFileSync(path.join(__dirname, 'tray-check.png'), Buffer.from(out.split(',')[1], 'base64'))
  console.log('ico native size ' + sz.width + 'x' + sz.height)
  app.exit(0)
})
