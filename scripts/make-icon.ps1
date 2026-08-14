# 由 assets/icon.png 生成多尺寸 assets/icon.ico
#
# Windows 在不同位置取不同尺寸：任务栏 32、桌面快捷方式 48、
# 资源管理器大图标 256、NSIS 安装向导头部 16 和 32。单尺寸的 ico
# 会被系统临时缩放，边缘发糊，所以这里一次把七个尺寸都烤进去。
#
# 用 .NET 的 System.Drawing 做缩放，不引入任何 npm 依赖。
# 每个尺寸以 PNG 压缩存放（Vista 起支持），256 那张才不会让文件膨胀到几 MB。
#
#   npm run icon
#
# 注意：这个文件必须保留 UTF-8 BOM。PowerShell 5.1 读没有 BOM 的 .ps1 会按
# 系统 ANSI 代码页（简中机器上是 GBK）解析，中文行尾注释的字节会跟后面的
# 换行符凑成一个 GBK 字符，把换行吃掉，导致下一行代码被并进注释而静默失效。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root 'assets\icon.png'
$outPath = Join-Path $root 'assets\icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)

if (-not (Test-Path $srcPath)) { throw "找不到源图：$srcPath" }

$image = [System.Drawing.Image]::FromFile($srcPath)
Write-Host "源图 $($image.Width)x$($image.Height)"

$frames = @()
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    # SourceCopy：直接写入像素而不是与透明底混合，缩小后边缘不会发暗
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($image, 0, 0, $size, $size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames += , $ms.ToArray()
    $bmp.Dispose()
    $ms.Dispose()
}
$image.Dispose()

# ---- 组装 ICO ----
# 文件头 6 字节 + 每帧 16 字节目录项，之后依次跟各帧的 PNG 数据
$fs = [System.IO.File]::Create($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)
try {
    $bw.Write([UInt16]0)              # 保留位
    $bw.Write([UInt16]1)              # 类型：1 = 图标
    $bw.Write([UInt16]$frames.Count)

    $offset = 6 + 16 * $frames.Count
    for ($i = 0; $i -lt $frames.Count; $i++) {
        # 256 在这里要写 0：这两个字段各只有一个字节
        $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
        $bw.Write([Byte]$dim)         # 宽
        $bw.Write([Byte]$dim)         # 高
        $bw.Write([Byte]0)            # 调色板色数，真彩为 0
        $bw.Write([Byte]0)            # 保留位
        $bw.Write([UInt16]1)          # 颜色平面
        $bw.Write([UInt16]32)         # 位深
        $bw.Write([UInt32]$frames[$i].Length)
        $bw.Write([UInt32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $bw.Write($frame) }
}
finally {
    $bw.Dispose()
    $fs.Dispose()
}

$kb = [math]::Round((Get-Item $outPath).Length / 1KB, 1)
Write-Host "已生成 assets\icon.ico — $($frames.Count) 个尺寸（$($sizes -join ', ')），$kb KB"
