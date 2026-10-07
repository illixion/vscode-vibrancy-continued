<#
  Vibrancy Continued - check whether the patches actually landed (Windows).

  Vibrancy works by patching files inside the editor's own installation. When
  the effect doesn't show up, the useful question is which of those patches
  are present, since an install can report success while a patch silently
  no-ops. This reads the installed files directly and reports what it finds.
  It is the Windows counterpart of diagnose.sh.

  Usage, in PowerShell with Vibrancy enabled and after fully quitting and
  reopening the editor:
    irm https://raw.githubusercontent.com/illixion/vscode-vibrancy-continued/main/scripts/diagnose.ps1 | iex

  Only one editor, or one install directory:
    & ([scriptblock]::Create((irm <url above>))) -Filter Cursor
    & ([scriptblock]::Create((irm <url above>))) -Filter 'C:\path\to\resources\app\out'

  Nothing is modified - this only reads. Kept to Windows PowerShell 5.1
  syntax and ASCII, since that is what `irm | iex` runs on a stock install.
#>
param([string]$Filter = '')

$RuntimeDir = 'vscode-vibrancy-runtime-v6'
$ExtPrefix = 'illixion.vscode-vibrancy-continued-'

function Say([string]$Label, $Value) { Write-Output ('{0,-42} {1}' -f $Label, $Value) }

function Read-Text([string]$Path) {
  try { return [IO.File]::ReadAllText($Path) } catch { return $null }
}

function Has([string]$Text, [string]$Needle) {
  if ($Text -and $Text.Contains($Needle)) { 'yes' } else { 'NO' }
}

function HasRe([string]$Text, [string]$Pattern) {
  if ($Text -and [regex]::IsMatch($Text, $Pattern)) { 'yes' } else { 'NO' }
}

# The read-only attribute, which a sync tool, an antivirus or a hand-made
# change can leave behind. It blocks Vibrancy's patching and can also stop
# the editor replacing an extension folder on update.
function Get-ReadOnly([string]$Dir) {
  @(Get-ChildItem -LiteralPath $Dir -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.IsReadOnly })
}

function First-Match([string]$Text, [string]$Pattern) {
  if (-not $Text) { return $null }
  $m = [regex]::Match($Text, $Pattern)
  if ($m.Success) { $m.Groups[1].Value } else { $null }
}

# Write access without writing: opening for write and closing again changes
# neither the contents nor the timestamp.
function Test-Writable([string]$Path) {
  try {
    $fs = [IO.File]::Open($Path, 'Open', 'ReadWrite', 'ReadWrite')
    $fs.Close()
    return 'yes'
  } catch {
    return 'NO (install needs elevation)'
  }
}

# --- Find installs --------------------------------------------------------

if ($Filter -and (Test-Path -LiteralPath $Filter -PathType Container)) {
  $candidates = @(Get-Item -LiteralPath $Filter)
  $Filter = ''
} else {
  $roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
  # Current VSCode keeps the app in a per-version folder next to Code.exe
  # (Microsoft VS Code\<commit>\resources\app\out); older builds and some
  # forks put it directly under the install folder. An update can leave the
  # previous version's folder behind, so every one found is reported.
  $candidates = foreach ($root in $roots) {
    foreach ($pattern in '*\resources\app\out', '*\*\resources\app\out') {
      Get-Item -Path (Join-Path $root $pattern) -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer }
    }
  }
}

$installs = @($candidates | Where-Object {
  (Test-Path -LiteralPath (Join-Path $_.FullName 'main.js')) -and
  (-not $Filter -or $_.FullName -like "*$Filter*")
})

Write-Output '=== Vibrancy Continued diagnostic (Windows) ==='
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
if ($os) {
  # Vibrancy picks its Windows 11 backdrop path by build number.
  $edition = if ([int]$os.BuildNumber -ge 22000) { 'Windows 11' } else { 'Windows 10' }
  Say 'Windows:' "$($os.Caption) build $($os.BuildNumber) (treated as $edition)"
}
Say 'architecture:' $env:PROCESSOR_ARCHITECTURE
Say 'PowerShell:' "$($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"

# Patched files are only read at startup. If the editor is still running, it
# is running whatever it loaded before, whatever the files now say.
$running = @(Get-Process -Name 'Code', 'Code - Insiders', 'VSCodium', 'Cursor', 'Windsurf' -ErrorAction SilentlyContinue |
  Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique)
Say 'editor processes running:' $(if ($running) { $running -join '; ' } else { 'none' })
Write-Output ''

# --- Installed extension versions -----------------------------------------
# The editor records the version it will load in extensions.json, and lists
# versions waiting to be deleted in .obsolete. An update that never took
# effect shows up as the record pointing at an older folder than the newest
# one on disk, or as the only folder present being an old one.

Write-Output '--- Vibrancy extension installs ---'
$extDirs = @(Get-Item -Path (Join-Path $HOME '.*\extensions') -Force -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer })
$newestInstalled = $null
$anyExt = $false
foreach ($extDir in $extDirs) {
  $folders = @(Get-ChildItem -LiteralPath $extDir.FullName -Directory -Force -Filter "$ExtPrefix*" -ErrorAction SilentlyContinue)
  if (-not $folders) { continue }
  $anyExt = $true
  $editor = Split-Path (Split-Path $extDir.FullName -Parent) -Leaf

  $obsolete = @()
  $obsoleteText = Read-Text (Join-Path $extDir.FullName '.obsolete')
  if ($obsoleteText) {
    try { $obsolete = @(($obsoleteText | ConvertFrom-Json).PSObject.Properties.Name) } catch {}
  }

  $recorded = $null
  $recordText = Read-Text (Join-Path $extDir.FullName 'extensions.json')
  if ($recordText) {
    try {
      $entry = @($recordText | ConvertFrom-Json) | ForEach-Object { $_ } |
        Where-Object { $_.identifier.id -eq 'illixion.vscode-vibrancy-continued' } | Select-Object -First 1
      if ($entry) { $recorded = $entry.version }
    } catch {}
  }

  foreach ($f in $folders) {
    # Open VSX installs carry a target suffix: ...-1.2.0-universal.
    $v = ($f.Name.Substring($ExtPrefix.Length) -split '-')[0]
    $notes = @()
    if ($obsolete -contains $f.Name) { $notes += 'obsolete, pending removal' }
    if ($recorded -and $v -eq $recorded) { $notes += 'the one the editor loads' }
    $ro = Get-ReadOnly $f.FullName
    if ($ro) { $notes += "READ-ONLY: $($ro.Count) file(s), e.g. $($ro[0].FullName.Substring($f.FullName.Length + 1))" }
    $suffix = if ($notes) { " ($($notes -join '; '))" } else { '' }
    Say "~\$editor\extensions:" "$v$suffix"
    if ($obsolete -notcontains $f.Name) {
      try {
        if (-not $newestInstalled -or [version]$v -gt [version]$newestInstalled) { $newestInstalled = $v }
      } catch {}
    }
  }
  Say "~\$editor recorded version:" $(if ($recorded) { $recorded } else { '<not in extensions.json>' })
}
if (-not $anyExt) { Say 'Vibrancy installed:' '<not found>' }
Write-Output ''

if (-not $installs) {
  Write-Output 'Could not find an editor install (a resources\app\out folder with main.js).'
  Write-Output 'Re-run with its path, e.g.:'
  Write-Output "  & ([scriptblock]::Create((irm <url>))) -Filter 'C:\path\to\resources\app\out'"
  return
}

# --- Each install ---------------------------------------------------------

foreach ($install in $installs) {
  $out = $install.FullName
  $main = Join-Path $out 'main.js'
  $mainImpl = Join-Path $out 'mainImpl.js'
  # VSCode 1.95+ has the Electron main and workbench main in one main.js, and
  # 1.140 moved window creation out of it again, into a sibling mainImpl.js.
  if (Test-Path -LiteralPath $mainImpl) {
    $windowFile = $mainImpl; $windowLabel = 'mainImpl.js (VSCode 1.140+)'
  } else {
    $windowFile = $main; $windowLabel = 'main.js (merged, VSCode 1.95-1.139)'
  }
  $mainText = Read-Text $main
  $windowText = Read-Text $windowFile

  Write-Output "=== $out ==="
  $pkg = Read-Text (Join-Path (Split-Path $out -Parent) 'package.json')
  Say 'editor version:' (First-Match $pkg '"version"\s*:\s*"([^"]*)"')
  Say 'window options live in:' $windowLabel
  Say 'writable without elevation:' (Test-Writable $main)
  $roFiles = @(@($main, $mainImpl) | Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object { Get-Item -LiteralPath $_ } | Where-Object { $_.IsReadOnly } | ForEach-Object { $_.Name })
  Say 'read-only attribute set:' $(if ($roFiles) { "YES on $($roFiles -join ', ')" } else { 'no' })

  # The patch records the version that made it. Patches before 1.4.0 carry it
  # only in the extension path they embed, so fall back to that.
  $patchedBy = First-Match $mainText '"vibrancyVersion":"([0-9][0-9.]*[0-9])'
  if (-not $patchedBy) { $patchedBy = First-Match $mainText 'illixion\.vscode-vibrancy-continued-([0-9][0-9.]*[0-9])' }
  Say 'Vibrancy version that patched:' $(if ($patchedBy) { $patchedBy } else { '<none>' })
  Write-Output ''

  # Everything below is meaningless if Vibrancy isn't applied here, so say so
  # up front rather than letting an unpatched file read as a broken patch.
  if (-not ($mainText -and $mainText.Contains('vscode_vibrancy_plugin'))) {
    Write-Output '!!! Vibrancy is NOT currently installed in this install.'
    Write-Output "!!! Run 'Enable Vibrancy', fully quit and reopen the editor, then re-run this."
    Write-Output ''
  } elseif ($patchedBy -and $newestInstalled) {
    try {
      if ([version]$newestInstalled -gt [version]$patchedBy) {
        Write-Output "!!! Patched by Vibrancy $patchedBy, but $newestInstalled is installed: the files predate the last update."
        Write-Output "!!! Fully quit the editor (no Code.exe left in Task Manager), reopen it, run 'Reload Vibrancy', then re-run this."
        Write-Output ''
      }
    } catch {}
  }

  Write-Output '--- 1. runtime bootstrap (workbench main.js) ---'
  Say 'vibrancy markers present:' (Has $mainText 'VSCODE-VIBRANCY-START')
  Say 'vscode_vibrancy_plugin injected:' (Has $mainText 'vscode_vibrancy_plugin')
  $runtime = Join-Path $out $RuntimeDir
  Say 'runtime folder present:' $(if (Test-Path -LiteralPath $runtime -PathType Container) { 'yes' } else { 'NO' })
  # The blur comes from a native module. Windows locks a loaded .node file, so
  # a copy deferred to after the editor exits can be missing or stale.
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $node = Get-Item -LiteralPath (Join-Path $runtime "vibrancy-$arch.node") -ErrorAction SilentlyContinue
  Say "native module (vibrancy-$arch.node):" $(if ($node) { "yes, $($node.Length) bytes, $($node.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))" } else { 'NO' })
  Write-Output ''

  Write-Output '--- 2. window options (electron main) ---'
  Say 'frameless (frame:false):' (HasRe $windowText 'frame:false|[A-Za-z_$][A-Za-z0-9_$]*\.frame=false,')
  Say 'transparent:true:' (HasRe $windowText 'transparent:true|\.transparent=true,')
  Say 'transparent:false:' (HasRe $windowText 'transparent:false|\.transparent=false,')
  # Options are injected at this anchor; if it's absent the injection can't apply.
  Say 'injection anchor present:' (Has $windowText 'experimentalDarkMode')
  Write-Output ''

  # Vibrancy embeds its settings into main.js at install time, so this shows the
  # config that actually produced the patch above, not what's in settings.json now.
  Write-Output '--- 2b. config used at install time (read back from main.js) ---'
  $cfg = First-Match $mainText '("config":\{[^}]*\})'
  foreach ($k in 'type', 'windowMode', 'windowControlsStyle', 'forceFramelessWindow', 'disableFramelessWindow') {
    $v = First-Match $cfg ('"' + $k + '":"?([A-Za-z0-9._-]*)"?')
    Say "${k}:" $(if ($v) { $v } else { '<not found>' })
  }
  # What the extension decided about this machine when it patched.
  $osRec = First-Match $mainText '"os":"([a-z0-9]*)"'
  $win11Rec = First-Match $mainText '"win11":(true|false)'
  Say 'os / win11 at install time:' "$(if ($osRec) { $osRec } else { '<not found>' }) / $(if ($win11Rec) { $win11Rec } else { '<not found>' })"
  Write-Output ''

  Write-Output '--- 3. CSP (workbench.html) ---'
  $html = Get-ChildItem -Path (Join-Path $out 'vs\code\electron-*\workbench\workbench*.html') -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($html) {
    Say 'html:' $html.FullName.Substring($out.Length + 1)
    Say 'trusted-types patched:' (Has (Read-Text $html.FullName) 'VscodeVibrancyContinued')
  } else {
    Say 'html:' 'NOT FOUND'
  }
  Write-Output ''
}

Write-Output '=== end ==='
