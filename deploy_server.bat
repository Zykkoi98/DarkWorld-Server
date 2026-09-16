@echo off
:: 🔥 Намертво переключаем кодировку консоли на UTF-8, чтобы русский текст не ломался!
chcp 65001 > log.txt

echo 🚀 Начинаем автоматическое обновление игры на GitHub Pages...
echo 🔍 Проверяем измененные файлы...

git add .
git commit -m "Auto-update: %date% %time%"
git push origin main

echo ✅ Игра успешно обновлена! Изменения появятся в Telegram через минуту.
:: Удаляем временный файл лога кодировки
if exist log.txt del log.txt
pause