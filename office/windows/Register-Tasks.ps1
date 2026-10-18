param([Parameter(Mandatory=$true)][string]$OfficeHome,[string]$BackupTime='23:00')
$ErrorActionPreference = 'Stop'
$homePath = (Resolve-Path $OfficeHome).Path
if (!(Test-Path (Join-Path $homePath 'config.json')) -or !(Test-Path (Join-Path $homePath 'backup-config.json'))) { throw 'Configure HTTPS/backup and perform a manual successful run first.' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$baseArgs = '-NoProfile -NonInteractive -File '
$officeScript = Join-Path $PSScriptRoot 'Start-Office.ps1'
$backupScript = Join-Path $PSScriptRoot 'Run-Backup.ps1'
$officeAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($baseArgs + '"' + $officeScript + '" -OfficeHome "' + $homePath + '"')
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($baseArgs + '"' + $backupScript + '" -OfficeHome "' + $homePath + '"')
$officeSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'HRC Office LAN' -Action $officeAction -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $identity) -Settings $officeSettings -Principal $principal -Description 'Shared encrypted office draft queue; requires trusted HTTPS and active Windows login.' -Force | Out-Null
Register-ScheduledTask -TaskName 'HRC Database Backup' -Action $backupAction -Trigger (New-ScheduledTaskTrigger -Daily -At $BackupTime) -Settings $backupSettings -Principal $principal -Description 'Encrypted read-only PostgreSQL backup; interactive user, no paid services.' -Force | Out-Null
$env:HRC_OFFICE_HOME = $homePath
$node = (Get-Command node.exe -ErrorAction Stop).Source
$next = (Get-ScheduledTaskInfo -TaskName 'HRC Database Backup').NextRunTime
if ($next -gt (Get-Date)) { & $node (Join-Path $PSScriptRoot '../backup-agent.mjs') task-status ($next.ToUniversalTime().ToString('o')) }
Get-ScheduledTask -TaskName 'HRC Office LAN','HRC Database Backup' | Select-Object TaskName,State
Write-Warning 'Tasks are INTERACTIVE: keep this Windows user signed in and the laptop awake. This is NOT an always-on Windows service. No passwords or paid subscriptions were configured.'
