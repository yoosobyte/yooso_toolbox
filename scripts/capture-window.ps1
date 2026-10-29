# 截取 Yooso Toolbox 窗口（用于验证 UI 是否正常渲染）
param(
    [string]$OutFile = "D:\RustroverProjects\yooso_toolbox\screenshot.png"
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*Yooso*" } | Select-Object -First 1
if (-not $proc) {
    Write-Output "NO_WINDOW"
    exit 2
}
Write-Output "window: $($proc.MainWindowTitle) (pid $($proc.Id))"

$handle = $proc.MainWindowHandle
[void][NativeWin]::ShowWindow($handle, 9)
[void][NativeWin]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 1200

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Write-Output "saved: $OutFile ($($bounds.Width)x$($bounds.Height))"
