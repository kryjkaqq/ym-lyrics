@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if not exist node_modules (
  echo Устанавливаю зависимости...
  call npm install || goto :err
)
node build.mjs --minify || goto :err
node patcher\patch.mjs install || goto :err
echo.
echo Готово! В Яндекс Музыке нажми L или кнопку "Текст".
pause
exit /b 0
:err
echo Установка не удалась.
pause
exit /b 1
