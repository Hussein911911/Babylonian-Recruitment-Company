param([Parameter(Mandatory=$true)][string]$OfficeHome)
$ErrorActionPreference = 'Stop'
$env:HRC_OFFICE_HOME = (Resolve-Path $OfficeHome).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot '../backup-agent.mjs') backup
$code = $LASTEXITCODE
try {
 $next = (Get-ScheduledTaskInfo -TaskName 'HRC Database Backup' -ErrorAction Stop).NextRunTime
 if ($next -gt (Get-Date)) { & $node (Join-Path $PSScriptRoot '../backup-agent.mjs') task-status ($next.ToUniversalTime().ToString('o')) }
} catch { Write-Warning 'Next Windows run time could not be verified; no next-run claim was made.' }
if ($code -ne 0) {
 Write-Warning 'HRC database backup FAILED. No new backup success was recorded. Check Office backup status.'
 # Local desktop warning, not an email/SMS subscription. A logged-out/sleeping
 # machine cannot deliver a desktop warning or run its interactive task.
 & msg.exe $env:USERNAME /TIME:120 'HRC: Database backup failed. Check the company laptop backup status.'
}
exit $code
