<#
  Vibrancy Continued - put back an editor's original files.

  Vibrancy patches files inside the editor's installation. If an editor won't
  start after enabling Vibrancy, or its window is invisible, Disable can't help:
  it runs inside the editor. Since 1.4.0 Vibrancy keeps the original of every
  file it patches next to it (main.js.vibrancy-orig), and this copies those
  originals back, so the editor starts again without being reinstalled.

  Usage, in PowerShell with the editor closed:
    irm https://raw.githubusercontent.com/illixion/vscode-vibrancy-continued/main/scripts/restore.ps1 | iex

  Only one editor, or one install directory:
    & ([scriptblock]::Create((irm <url above>))) -Filter Cursor
    & ([scriptblock]::Create((irm <url above>))) -Filter 'C:\path\to\resources\app\out'

  An editor installed for all users (under Program Files) needs PowerShell
  opened as administrator. Vibrancy itself stays installed: once the editor
  starts, run "Disable Vibrancy" to remove its colour settings too.
#>
param([string]$Filter = '')

$Suffix = '.vibrancy-orig'

if ($Filter -and (Test-Path -LiteralPath $Filter -PathType Container)) {
  $candidates = @(Get-Item -LiteralPath $Filter)
  $Filter = ''
} else {
  $roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
  # Current VSCode keeps the app in a per-version folder next to Code.exe
  # (Microsoft VS Code\<commit>\resources\app\out); older builds and some
  # forks put it directly under the install folder.
  $candidates = foreach ($root in $roots) {
    foreach ($pattern in '*\resources\app\out', '*\*\resources\app\out') {
      # Get-Item, not Get-ChildItem: the folders themselves, not their contents.
      Get-Item -Path (Join-Path $root $pattern) -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer }
    }
  }
}

$restored = 0
foreach ($out in $candidates) {
  if ($Filter -and ($out.FullName -notlike "*$Filter*")) { continue }

  foreach ($backup in Get-ChildItem -LiteralPath $out.FullName -Filter "*$Suffix" -File -ErrorAction SilentlyContinue) {
    $original = $backup.FullName.Substring(0, $backup.FullName.Length - $Suffix.Length)
    try {
      Copy-Item -LiteralPath $backup.FullName -Destination $original -Force -ErrorAction Stop
      Remove-Item -LiteralPath $backup.FullName -Force -ErrorAction Stop
      Write-Output "restored: $original"
      $restored++
    } catch {
      Write-Output "FAILED:   $original ($($_.Exception.Message))"
      Write-Output '          If access was denied, run PowerShell as administrator and try again.'
    }
  }
}

if ($restored -eq 0) {
  $matching = if ($Filter) { " matching ""$Filter""" } else { '' }
  Write-Output "Found no files to restore$matching."
  Write-Output 'Vibrancy keeps originals from version 1.4.0 on. If the editor was patched by an'
  Write-Output 'older version, or yours is installed elsewhere, pass its resources\app\out directory'
  Write-Output 'with -Filter. Otherwise reinstalling the editor restores its files.'
  return
}

Write-Output ''
Write-Output 'Done. Start the editor, then run "Disable Vibrancy" to remove its colour settings,'
Write-Output 'and please report what happened: https://github.com/illixion/vscode-vibrancy-continued/issues'
