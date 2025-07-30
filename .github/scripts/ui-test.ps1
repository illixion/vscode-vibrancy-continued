$vsix = Get-ChildItem *.vsix | Select-Object -First 1
$vscodePath = "$env:USERPROFILE\vscode-portable\Code.exe"
$vscodeCliPath = "$env:USERPROFILE\vscode-portable\bin\code"


# Set up extension
Start-Process $vscodeCliPath -ArgumentList "--install-extension $($vsix.FullName) --force"
Start-Sleep -Seconds 3

$env:VIBRANCY_AUTO_INSTALL = "true"

Start-Process $vscodePath
Start-Sleep -Seconds 10

$proc = Get-Process | Where-Object { $_.Path -eq $vscodePath -or $_.ProcessName -like "Code*" }
if ($null -ne $proc) {
Write-Host "Killing VSCode process: $($proc.Id)"
$proc | Stop-Process -Force
}

$env:VIBRANCY_AUTO_INSTALL = $null


# Adjust system settings
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" -Name EnableTransparency -Value 1


# Minimize everything
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class WindowHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    public const int SW_MINIMIZE = 6;
    public const uint GW_OWNER = 4;

    public static void MinimizeAllTopLevelWindows() {
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
            if (IsWindowVisible(hWnd) && GetWindow(hWnd, GW_OWNER) == IntPtr.Zero) {
                ShowWindow(hWnd, SW_MINIMIZE);
            }
            return true;
        }, IntPtr.Zero);
    }
}
"@

[WindowHelper]::MinimizeAllTopLevelWindows()


# Set wallpaper to color bars
$imgPath = "$env:TEMP\colorbars.bmp"
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1920, 1080
$g = [System.Drawing.Graphics]::FromImage($bmp)
$colors = [System.Drawing.Color[]]@("Red","Orange","Yellow","Green","Blue","Indigo","Violet")
$barWidth = $bmp.Width / $colors.Length
for ($i = 0; $i -lt $colors.Length; $i++) {
    $brush = New-Object System.Drawing.SolidBrush $colors[$i]
    $g.FillRectangle($brush, $i * $barWidth, 0, $barWidth, $bmp.Height)
}
$bmp.Save($imgPath, [System.Drawing.Imaging.ImageFormat]::Bmp)

Add-Type @"
using System.Runtime.InteropServices;
public class Wallpaper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@
$SPI_SETDESKWALLPAPER = 0x0014
$SPIF_UPDATEINIFILE = 0x01
$SPIF_SENDWININICHANGE = 0x02
[Wallpaper]::SystemParametersInfo($SPI_SETDESKWALLPAPER, 0, $imgPath, $SPIF_UPDATEINIFILE -bor $SPIF_SENDWININICHANGE)


# Launch VSCode
Start-Process $vscodePath -ArgumentList "extension/index.js"
Start-Sleep -Seconds 10