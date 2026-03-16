@echo off
rem При двойном щелчке запускаем себя в новом окне с cmd /k — окно не закроется после выполнения
if "%~1"=="" (
    start "Deploy MAX Vigruzka" cmd /k "%~f0" run
    exit /b 0
)
if /i not "%~1"=="run" (
    start "Deploy MAX Vigruzka" cmd /k "%~f0" run %*
    exit /b 0
)

chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ============================================
echo   MAX VIGRUZKA - DEPLOY (LOCAL + SERVER)
echo ============================================
echo.

rem --- Сообщение коммита (при запуске с "run" первый аргумент отбрасываем) ---
shift
set "COMMIT_MSG=%*"
if "%COMMIT_MSG%"=="" (
    set /P COMMIT_MSG=Введите сообщение коммита: 
)

echo.
echo [1/5] Статус репозитория...
git status
if errorlevel 1 (
    echo ОШИБКА: git status
    pause
    exit /b 1
)

echo.
echo [2/5] Добавляю изменения...
git add -A
if errorlevel 1 (
    echo ОШИБКА: git add
    pause
    exit /b 1
)

echo.
echo [3/5] Коммит: "%COMMIT_MSG%"
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo INFO: Коммит не создан (нет изменений или ошибка)
)

echo.
echo [4/5] Отправляю в репозиторий...
git push
if errorlevel 1 (
    echo ОШИБКА: git push
    pause
    exit /b 1
)

echo.
echo [5/5] Обновление на сервере: git pull, сборка фронта, выкладка в /var/www...
echo Внимание: git reset --hard на сервере сотрёт локальные правки на VPS.
echo.

set "SSH_KEY=%USERPROFILE%\.ssh\id_ed25519_maxvigruzka"
set "SSH_CMD=ssh root@178.255.127.75"
if exist "%SSH_KEY%" (
    set "SSH_CMD=ssh -i "%SSH_KEY%" root@178.255.127.75"
    echo Использую ключ: %SSH_KEY%
) else (
    echo Ключ не найден: %SSH_KEY% ^(подключение без -i^)
)

echo.
echo 5a. Проверка SSH...
%SSH_CMD% "echo SSH_OK"
if errorlevel 1 (
    echo ОШИБКА: не удалось подключиться к серверу. Проверьте ключ и доступ.
    goto :finish
)
echo SSH подключение OK.
echo.

echo 5b. На сервере: git fetch + reset origin/master...
%SSH_CMD% "cd /opt/max-vigruzka && git fetch origin && git reset --hard origin/master && git log -1 --oneline"
if errorlevel 1 (
    echo ОШИБКА: git на сервере.
    goto :finish
)
echo.

echo 5c. На сервере: копирование .env и перезапуск бэкенда...
%SSH_CMD% "cd /opt/max-vigruzka && if [ -f backend/.env.example ]; then cp backend/.env.example backend/.env && echo .env скопирован; else echo .env.example не найден; fi && cd backend && npm install && pm2 restart max-vigruzka || pm2 start ecosystem.config.js && echo Бэкенд перезапущен"
if errorlevel 1 (
    echo ОШИБКА: установка зависимостей или перезапуск бэкенда.
    goto :finish
)
echo.

echo 5d. На сервере: сборка фронта и копирование в /var/www/max-vigruzka...
%SSH_CMD% "cd /opt/max-vigruzka/frontend && chmod +x node_modules/.bin/vite 2>/dev/null; npm install && npm run build && mkdir -p /var/www/max-vigruzka && rm -rf /var/www/max-vigruzka/* && cp -r dist/* /var/www/max-vigruzka/ && echo FILES: && ls -la /var/www/max-vigruzka/ && systemctl reload nginx && echo NGINX reload OK"
if errorlevel 1 (
    echo ОШИБКА: сборка или копирование на сервере.
    goto :finish
)
echo.
echo ============================================
echo   ДЕПЛО ЗАВЕРШЁН
echo   Проверьте https://mintday.ru/ и приложение в MAX
echo ============================================

:finish
echo.
echo Нажмите любую клавишу, чтобы закрыть окно...
pause
