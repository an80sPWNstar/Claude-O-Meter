// Static tray icon candidates + a preview sheet.
//   unset ELECTRON_RUN_AS_NODE && ./node_modules/electron/dist/electron.exe design/tray-candidates.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs'); const path = require('path')
const OUT = path.join(__dirname, 'tray-candidates.png')

const PAGE = `<!DOCTYPE html><meta charset="utf-8"><body><script>
var CREAM='#F0EEE6', TERRA='#D97757', EMBER='#C24E30', INK='#1F1E1B'
function rad(d){ return (d-90)*Math.PI/180 }
function cv(s){ var c=document.createElement('canvas'); c.width=c.height=s; return c }
function tile(ctx,s,radius,fill){
  var r=s*radius
  ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(s-r,0); ctx.quadraticCurveTo(s,0,s,r)
  ctx.lineTo(s,s-r); ctx.quadraticCurveTo(s,s,s-r,s); ctx.lineTo(r,s)
  ctx.quadraticCurveTo(0,s,0,s-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0)
  ctx.closePath(); ctx.fillStyle=fill; ctx.fill()
}
// weight/radius correction per size, same idea as make-icons
function met(s){
  if (s<=16) return { r:0.375, w:0.250 }
  if (s<=24) return { r:0.365, w:0.225 }
  if (s<=32) return { r:0.355, w:0.210 }
  return { r:0.340, w:0.185 }
}
function metTile(s){
  if (s<=16) return { r:0.330, w:0.215, radius:0.20 }
  if (s<=24) return { r:0.325, w:0.195, radius:0.21 }
  if (s<=32) return { r:0.320, w:0.185, radius:0.22 }
  return { r:0.3125,w:0.160, radius:0.22 }
}
function ringC(ctx,s,m,color){
  var cx=s/2
  ctx.lineWidth=s*m.w; ctx.lineCap='butt'; ctx.strokeStyle=color
  ctx.beginPath(); ctx.arc(cx,cx,s*m.r, rad(50), rad(310)); ctx.stroke()
}
// A: bare terracotta C, transparent background
function A(s){ var c=cv(s),x=c.getContext('2d'); ringC(x,s,met(s),TERRA); return c }
// B: cream tile + terracotta C  (mini app icon)
function B(s){ var c=cv(s),x=c.getContext('2d'); var m=metTile(s); tile(x,s,m.radius,CREAM); ringC(x,s,m,TERRA); return c }
// C: terracotta tile + cream C
function C(s){ var c=cv(s),x=c.getContext('2d'); var m=metTile(s); tile(x,s,m.radius,TERRA); ringC(x,s,m,CREAM); return c }
// D: solid terracotta disc + cream C
function D(s){
  var c=cv(s),x=c.getContext('2d'),m=met(s),cx=s/2
  x.fillStyle=TERRA; x.beginPath(); x.arc(cx,cx,s*0.5,0,Math.PI*2); x.fill()
  var mm={ r:m.r*0.80, w:m.w*0.85 }
  ringC(x,s,mm,CREAM); return c
}
var KIND={ A:A, B:B, C:C, D:D }
window.render=function(jobs){ return jobs.map(function(j){ return KIND[j.k](j.s).toDataURL('image/png') }) }

// Preview sheet: 16px actual size on dark + light bars, then 8x zoom.
window.sheet=function(){
  var keys=['A','B','C','D'], W=560, H=260
  var c=cv(1); c.width=W; c.height=H; var x=c.getContext('2d')
  x.imageSmoothingEnabled=false
  x.fillStyle='#2b2b2b'; x.fillRect(0,0,W,H)
  x.font='12px Consolas,monospace'; x.textBaseline='middle'
  // dark taskbar strip
  x.fillStyle='#1c1c1c'; x.fillRect(0,20,W,32)
  x.fillStyle='#888'; x.fillText('dark taskbar, actual 16px', 12, 12)
  // light strip
  x.fillStyle='#e9e9e9'; x.fillRect(0,72,W,32)
  x.fillStyle='#888'; x.fillText('light taskbar, actual 16px', 12, 64)
  keys.forEach(function(k,i){
    var px=110+i*100
    x.drawImage(KIND[k](16),px,28)
    x.drawImage(KIND[k](16),px,80)
    // 8x zoom of the 32px render
    x.drawImage(KIND[k](32),px-24,130,64,64)
    x.fillStyle='#ddd'; x.fillText(k, px+4, 208)
  })
  x.fillStyle='#888'; x.fillText('32px render, 2x', 12, 160)
  return c.toDataURL('image/png')
}
</script></body>`

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor','1')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width:600, height:400, show:false,
    webPreferences:{ contextIsolation:false, nodeIntegration:false, offscreen:true } })
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(PAGE))
  const url = await win.webContents.executeJavaScript('window.sheet()')
  fs.writeFileSync(OUT, Buffer.from(url.split(',')[1],'base64'))
  console.log('wrote '+OUT+' '+fs.statSync(OUT).size+' bytes')
  app.exit(0)
})
