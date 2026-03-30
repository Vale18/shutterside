$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $root '.venv\Scripts\python.exe'

if (-not (Test-Path $venvPython)) {
  Write-Error 'Die virtuelle Umgebung fehlt. Bitte zuerst .\setup.ps1 ausführen.'
}

& $venvPython (Join-Path $root 'app.py')
