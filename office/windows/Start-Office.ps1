param([Parameter(Mandatory=$true)][string]$OfficeHome)
$ErrorActionPreference = 'Stop'
$env:HRC_OFFICE_HOME = (Resolve-Path $OfficeHome).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot '../server.mjs')
exit $LASTEXITCODE
