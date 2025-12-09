// ================== КОНФИГ ==================
const BASE_URL = "https://ndb.fut.ru";
const TABLE_ID = "m6tyxd3346dlhco";
const API_KEY = "N0eYiucuiiwSGIvPK5uIcOasZc_nJy6mBUihgaYQ";

const RECORDS_ENDPOINT = `${BASE_URL}/api/v2/tables/${TABLE_ID}/records`;
const FILE_UPLOAD_ENDPOINT = `${BASE_URL}/api/v2/storage/upload`;

// поле для резюме
const RESUME_FIELD_ID = "crizvpe2wzh0s98";

let currentRecordId = null;
let userPlatform = null;
let rawUserId = null;

const screens = {
    upload: document.getElementById("uploadScreen"),
    result: document.getElementById("resultScreen")
};

// ================== ВСПОМОГАТЕЛЬНЫЕ ==================

function showScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
    if (screens[name]) {
        screens[name].classList.remove("hidden");
    }
}

function showError(msg) {
    document.body.className = "";
    document.body.innerHTML = `
        <div class="app-error">
            <div>
                <h2>Ошибка</h2>
                <p style="font-size:18px;margin:25px 0;">${msg}</p>
                <button onclick="location.reload()">Попробовать снова</button>
            </div>
        </div>
    `;
}

// Ждём vkBridge (важно для VK Mini Apps)
async function waitForVkBridge() {
    return new Promise(resolve => {
        if (window.vkBridge) return resolve(window.vkBridge);
        const check = setInterval(() => {
            if (window.vkBridge) {
                clearInterval(check);
                resolve(window.vkBridge);
            }
        }, 50);
        setTimeout(() => {
            clearInterval(check);
            resolve(null);
        }, 5000);
    });
}

// Поиск пользователя по tg-id (с поддержкой _VK)
async function findUser(id) {
    // Telegram ID как есть
    let res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${id})`, {
        headers: { "xc-token": API_KEY }
    });
    let data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "tg" };
    }

    // VK ID c суффиксом _VK
    const vkValue = id + "_VK";
    res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${vkValue})`, {
        headers: { "xc-token": API_KEY }
    });
    data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "vk" };
    }

    return null;
}

// Загрузка файла резюме
async function uploadResume(recordId, file) {
    if (!recordId) {
        throw new Error("Технический режим: запись в базу недоступна.");
    }

    const form = new FormData();
    form.append("file", file);
    form.append("path", "resumes");

    const upload = await fetch(FILE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "xc-token": API_KEY },
        body: form
    });

    if (!upload.ok) throw new Error("Ошибка загрузки файла на сервер");

    const info = await upload.json();
    const fileData = Array.isArray(info) ? info[0] : info;
    const url = fileData.url || `${BASE_URL}/${fileData.path}`;

    const attachment = [{
        title: fileData.title || file.name,
        mimetype: file.type || fileData.mimetype,
        size: file.size,
        url: url
    }];

    const body = {
        Id: Number(recordId),
        [RESUME_FIELD_ID]: attachment
    };

    const patch = await fetch(RECORDS_ENDPOINT, {
        method: "PATCH",
        headers: {
            "xc-token": API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!patch.ok) {
        const err = await patch.text();
        console.error("PATCH error:", err);
        throw new Error("Не удалось сохранить файл в базу.");
    }
}

// Фейковый прогресс
async function fakeProgress() {
    const bar = document.getElementById("progress");
    const status = document.getElementById("status");
    let p = 0;

    return new Promise(resolve => {
        const int = setInterval(() => {
            p += 12 + Math.random() * 20;
            if (p >= 100) {
                p = 100;
                clearInterval(int);
                status.textContent = "Резюме успешно загружено!";
                resolve();
            }
            bar.style.width = p + "%";
            status.textContent = `Загрузка ${Math.round(p)}%`;
        }, 120);
    });
}

// ================== СТАРТ ==================

(async () => {
    try {
        let found = false;

        // ---- 1. Пытаемся определить VK среду ----
        const bridge = await waitForVkBridge();
        if (bridge) {
            try {
                // Рекомендованный VK вызов
                await bridge.send("VKWebAppInit");
                const userInfo = await bridge.send("VKWebAppGetUserInfo");
                if (userInfo && userInfo.id) {
                    rawUserId = userInfo.id;
                    userPlatform = "vk";
                    found = true;
                    console.log("VK пользователь:", rawUserId);
                }
            } catch (vkErr) {
                console.log("VK Bridge неактивен в этом окружении", vkErr);
            }
        }

        // ---- 2. Если не VK — пробуем Telegram WebApp ----
        if (!found && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            const tg = window.Telegram.WebApp;
            try {
                tg.ready();
                tg.expand();
            } catch (e) {
                console.log("Telegram WebApp готов, но expand/ready упали", e);
            }
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            found = true;
            console.log("Telegram пользователь:", rawUserId);
        }

        // ---- 3. Если не нашли ни VK, ни Telegram — обычный браузер (GitHub Pages) ----
        if (!found || !rawUserId) {
            console.log("Обычный веб-браузер: включаем демо-режим без привязки к пользователю");
            showScreen("upload");
            const errorBlock = document.getElementById("error");
            if (errorBlock) {
                errorBlock.textContent = "Вы на демо-версии (GitHub Pages). Загрузка в базу отключена.";
                errorBlock.classList.remove("hidden");
            }
            return; // дальше не ищем пользователя в таблице
        }

        // ---- 4. Ищем пользователя в базе ----
        const user = await findUser(rawUserId);
        if (!user) {
            // Пользователь не найден в таблице: покажем форму, но предупредим
            console.warn("Пользователь не найден в базе");
            showScreen("upload");
            const errorBlock = document.getElementById("error");
            if (errorBlock) {
                errorBlock.textContent = "Вы не зарегистрированы. Напишите в бот, чтобы привязать аккаунт.";
                errorBlock.classList.remove("hidden");
            }
            // currentRecordId остаётся null → uploadResume выдаст понятную ошибку
            return;
        }

        currentRecordId = user.recordId;
        userPlatform = user.platform;

        // ---- 5. Всё ок, показываем экран загрузки ----
        showScreen("upload");

    } catch (err) {
        console.error(err);
        showError(err.message || "Ошибка запуска");
    }
})();

// ================== ОБРАБОТЧИКИ ==================

// Загрузка резюме
document.getElementById("submitFile")?.addEventListener("click", async () => {
    const input = document.getElementById("fileInput");
    const error = document.getElementById("error");
    const file = input.files[0];

    error.classList.add("hidden");
    error.textContent = "";

    if (!file) {
        error.textContent = "Выберите файл.";
        error.classList.remove("hidden");
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        error.textContent = "Файл больше 15 МБ.";
        error.classList.remove("hidden");
        return;
    }

    const allowed = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/png",
        "image/jpeg"
    ];

    if (!allowed.includes(file.type)) {
        error.textContent = "Допустимы только PDF, DOC/DOCX или PNG/JPG.";
        error.classList.remove("hidden");
        return;
    }

    try {
        await fakeProgress();
        await uploadResume(currentRecordId, file);
        showScreen("result");
    } catch (e) {
        error.textContent = e.message || "Ошибка загрузки файла.";
        error.classList.remove("hidden");
    }
});

// Кнопка закрытия
document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        window.vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    } else {
        window.close();
    }
});
