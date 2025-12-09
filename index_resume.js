const BASE_URL = "https://ndb.fut.ru";
TABLE_ID = "m6tyxd3346dlhco";
API_KEY = "N0eYiucuiiwSGIvPK5uIcOasZc_nJy6mBUihgaYQ";

RECORDS_ENDPOINT = `${BASE_URL}/api/v2/tables/${TABLE_ID}/records`;
FILE_UPLOAD_ENDPOINT = `${BASE_URL}/api/v2/storage/upload`;

RESUME_FIELD_ID = "crizvpe2wzh0s98"; // поле для резюме

let currentRecordId = null;
let userPlatform = null;
let rawUserId = null;

const screens = {
    upload: document.getElementById("uploadScreen"),
    result: document.getElementById("resultScreen")
};

function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (screens[name]) screens[name].classList.remove('hidden');
}

function showError(msg) {
    document.body.innerHTML = `
        <div style="padding:50px;text-align:center;color:white;font-family:sans-serif;">
            <h2>Ошибка</h2>
            <p style="font-size:18px;margin:18px;margin:30px 0;">${msg}</p>
            <button onclick="location.reload()" style="padding:15px 35px;font-size:17px;border-radius:8px;">Попробовать снова</button>
        </div>`;
}

// Ждём vkBridge (важно для VK Mini Apps 2025)
async function waitForVkBridge() {
    return new Promise(resolve => {
        if (window.vkBridge) return resolve(window.vkBridge);
        const check = setInterval(() => {
            if (window.vkBridge) {
                clearInterval(check);
                resolve(window.vkBridge);
            }
        }, 50);
        setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
    });
}

// Поиск пользователя по tg-id (с поддержкой _VK)
async function findUser(id) {
    // Сначала ищем как Telegram ID
    let res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${id})`, {
        headers: { "xc-token": API_KEY }
    });
    let data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: 'tg' };
    }

    // Потом как VK
    const vkValue = id + "_VK";
    res = await fetch(`${RECORDS_ENDPOINT}?where=(tg-id,eq,${vkValue})`, {
        headers: { "xc-token": API_KEY }
    });
    data = await res.json();
    if (data.list?.length > 0) {
        return { recordId: data.list[0].Id || data.list[0].id, platform: 'vk' };
    }

    return null;
}

// Загрузка файла резюме
async function uploadResume(recordId, file) {
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
        throw new Error("Не удалось сохранить в базу");
    }
}

// Прогресс (фейковый, но красивый)
async function fakeProgress() {
    const bar = document.getElementById("progress");
    const status = document.getElementById("status");
    let p = 0;
    return new Promise(res => {
        const int = setInterval(() => {
            p += 12 + Math.random() * 20;
            if (p >= 100) {
                p = 100;
                clearInterval(int);
                status.textContent = "Резюме успешно загружено!";
                res();
            }
            bar.style.width = p + "%";
            status.textContent = `Загрузка ${Math.round(p)}%`;
        }, 120);
    });
}

// =================================== СТАРТ ===================================
(async () => {
    try {
        let found = false;

        // 1. Пытаемся определить VK
        const bridge = await waitForVkBridge();
        if (bridge) {
            await bridge.send("VKWebAppInit");
            const userInfo = await bridge.send("VKWebAppGetUserInfo");
            rawUserId = userInfo.id;
            userPlatform = "vk";
            found = true;
            console.log("VK пользователь:", rawUserId);
        }

        // 2. Если не VK — значит Telegram
        if (!found && window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            found = true;
            console.log("Telegram пользователь:", rawUserId);
        }

        if (!found || !rawUserId) {
            throw new Error("Не удалось определить платформу или пользователя");
        }

        // 3. Ищем пользователя в базе
        const user = await findUser(rawUserId);
        if (!user) {
            throw new Error("Вы не зарегистрированы. Напишите в бот @вашбот");
        }

        currentRecordId = user.recordId;
        userPlatform = user.platform; // точная платформа из базы

        // 4. Всё готово — показываем экран загрузки
        showScreen("upload");

    } catch (err) {
        console.error(err);
        showError(err.message || "Ошибка запуска");
    }
})();

// =================================== ЗАГРУЗКА РЕЗЮМЕ ===================================
document.getElementById("submitFile")?.addEventListener("click", async () => {
    const input = document.getElementById("fileInput");
    const error = document.getElementById("error");
    const file = input.files[0];

    error.classList.add("hidden");

    if (!file) return error.textContent = "Выберите файл", error.classList.remove("hidden");
    if (file.size > 15 * 1024 * 1024) return error.textContent = "Файл больше 15 МБ", error.classList.remove("hidden");

    const allowed = ["application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","image/png","image/jpeg"];
    if (!allowed.includes(file.type)) return error.textContent = "Только PDF, Word или фото", error.classList.remove("hidden");

    try {
        await fakeProgress();
        await uploadResume(currentRecordId, file);
        showScreen("result");
    } catch (e) {
        error.textContent = e.message || "Ошибка загрузки";
        error.classList.remove("hidden");
    }
});

// Кнопка закрытия на финальном экране
document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    } else {
        window.close();
    }
});