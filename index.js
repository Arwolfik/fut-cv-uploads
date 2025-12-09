// ================== КОНФИГ ==================
const BASE_URL = "https://ndb.fut.ru";
const TABLE_ID = "m6tyxd3346dlhco";
const API_KEY = "N0eYiucuiiwSGIvPK5uIcOasZc_nJy6mBUihgaYQ";

const RECORDS_ENDPOINT = `${BASE_URL}/api/v2/tables/${TABLE_ID}/records`;
const FILE_UPLOAD_ENDPOINT = `${BASE_URL}/api/v2/storage/upload`;

const RESUME_FIELD_ID = "crizvpe2wzh0s98"; // поле для резюме

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

function showInlineError(msg) {
    const error = document.getElementById("error");
    if (!error) return;
    error.textContent = msg;
    error.classList.remove("hidden");
}

function clearInlineError() {
    const error = document.getElementById("error");
    if (!error) return;
    error.textContent = "";
    error.classList.add("hidden");
}

function showErrorFatal(msg) {
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

// Поиск пользователя по tg-id (с поддержкой _VK)
async function findUser(id) {
    // Telegram ID
    let res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${id})`, {
        headers: { "xc-token": API_KEY }
    });
    let data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: "tg" };
    }

    // VK ID с суффиксом _VK
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

// Загрузка файла резюме в хранилище и запись в таблицу
async function uploadResume(recordId, file) {
    if (!recordId) {
        throw new Error("Техническая ошибка: не найдена запись пользователя в базе.");
    }

    const form = new FormData();
    form.append("file", file);
    form.append("path", "resumes");

    const upload = await fetch(FILE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "xc-token": API_KEY },
        body: form
    });

    if (!upload.ok) throw new Error("Ошибка загрузки файла на сервер.");

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
        const errText = await patch.text();
        console.error("PATCH error:", errText);
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
        // 1. Сразу показываем экран загрузки, чтобы не было белого экрана
        showScreen("upload");

        // 2. Определяем платформу
        // Сначала Telegram (ты запускаешь через tg)
        if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            const tg = window.Telegram.WebApp;
            try {
                tg.ready();
                tg.expand();
            } catch (e) {
                console.log("Telegram ready/expand error:", e);
            }
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            console.log("Telegram пользователь:", rawUserId);
        }
        // Если не Telegram — пробуем VK Mini Apps
        else if (window.vkBridge) {
            try {
                await window.vkBridge.send("VKWebAppInit");
                const userInfo = await window.vkBridge.send("VKWebAppGetUserInfo");
                if (userInfo && userInfo.id) {
                    rawUserId = userInfo.id;
                    userPlatform = "vk";
                    console.log("VK пользователь:", rawUserId);
                }
            } catch (vkErr) {
                console.log("VK Bridge недоступен в этом окружении:", vkErr);
            }
        }

        if (!rawUserId) {
            // В Telegram сюда попадать не должны, значит что-то не так с initDataUnsafe
            showInlineError("Не удалось определить пользователя. Откройте приложение из Telegram-бота.");
            return;
        }

        // 3. Пытаемся найти пользователя в базе
        try {
            const user = await findUser(rawUserId);
            if (!user) {
                showInlineError("Вы не зарегистрированы. Напишите в бот, чтобы привязать аккаунт.");
                return;
            }
            currentRecordId = user.recordId;
            userPlatform = user.platform;
            console.log("Найдена запись в базе:", currentRecordId, userPlatform);
        } catch (dbErr) {
            console.error("Ошибка при поиске пользователя:", dbErr);
            showInlineError("Не удалось получить данные пользователя. Попробуйте позже.");
        }
    } catch (err) {
        console.error("Критическая ошибка:", err);
        showErrorFatal("Критическая ошибка запуска приложения.");
    }
})();

// ================== ОБРАБОТЧИКИ ==================

// Отправка файла
document.getElementById("submitFile")?.addEventListener("click", async () => {
    const input = document.getElementById("fileInput");
    const file = input.files[0];

    clearInlineError();

    if (!file) {
        showInlineError("Выберите файл.");
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        showInlineError("Файл больше 15 МБ.");
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
        showInlineError("Допустимы только PDF, DOC/DOCX или PNG/JPG.");
        return;
    }

    try {
        await fakeProgress();
        await uploadResume(currentRecordId, file);
        showScreen("result");
    } catch (e) {
        console.error("Ошибка загрузки:", e);
        showInlineError(e.message || "Ошибка загрузки файла.");
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
