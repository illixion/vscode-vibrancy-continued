# Wait 1 minute for the system to stabilize
Start-Sleep -Seconds 60

# Print a list of all currently running processes
Get-Process | ForEach-Object {
    Write-Host "Process: $($_.ProcessName) (ID: $($_.Id))"
}

# Also print a list of all processes that currently have a window open
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
    Write-Host "Process with window: $($_.ProcessName) (ID: $($_.Id))"
}

# Early exit for test
exit 1