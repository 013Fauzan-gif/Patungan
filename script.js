const STORAGE_KEY = "patungan-v1";

const state = {
    people: [],
    items: [],
    taxPercent: 0,
    servicePercent: 0
};

const selectedForNewItem = new Set();

const personForm = document.getElementById("person-form");
const personNameInput = document.getElementById("person-name");
const personMessage = document.getElementById("person-message");
const peopleList = document.getElementById("people-list");
const itemForm = document.getElementById("item-form");
const itemNameInput = document.getElementById("item-name");
const itemAmountInput = document.getElementById("item-amount");
const splitOptions = document.getElementById("split-options");
const itemMessage = document.getElementById("item-message");
const addItemBtn = document.getElementById("add-item-btn");
const itemList = document.getElementById("item-list");
const taxInput = document.getElementById("tax-percent");
const serviceInput = document.getElementById("service-percent");
const receiptBody = document.getElementById("receipt-body");
const copyBtn = document.getElementById("copy-btn");
const resetBtn = document.getElementById("reset-btn");
const toast = document.getElementById("toast");

document.addEventListener("DOMContentLoaded", () => {
    loadState();
    if (selectedForNewItem.size === 0) {
        state.people.forEach((person) => selectedForNewItem.add(person.id));
    }
    taxInput.value = String(state.taxPercent);
    serviceInput.value = String(state.servicePercent);
    render();
});

personForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addPerson();
});

itemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addItem();
});

taxInput.addEventListener("input", () => {
    state.taxPercent = readPercent(taxInput);
    saveState();
    renderReceipt();
});

serviceInput.addEventListener("input", () => {
    state.servicePercent = readPercent(serviceInput);
    saveState();
    renderReceipt();
});

copyBtn.addEventListener("click", copySummary);
resetBtn.addEventListener("click", resetAll);

function addPerson() {
    const name = personNameInput.value.trim().replace(/\s+/g, " ");
    if (!name) {
        setMessage(personMessage, "Isi nama peserta dulu.");
        return;
    }

    const exists = state.people.some((person) => person.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        setMessage(personMessage, "Nama itu sudah ada.");
        return;
    }

    const person = { id: createId(), name };
    state.people.push(person);
    selectedForNewItem.add(person.id);
    personNameInput.value = "";
    setMessage(personMessage, "");
    saveState();
    render();
    personNameInput.focus();
}

function removePerson(id) {
    state.people = state.people.filter((person) => person.id !== id);
    selectedForNewItem.delete(id);
    state.items.forEach((item) => {
        item.personIds = item.personIds.filter((personId) => personId !== id);
    });
    saveState();
    render();
}

function addItem() {
    if (state.people.length === 0) {
        setMessage(itemMessage, "Tambahkan peserta dulu.");
        return;
    }

    const name = itemNameInput.value.trim().replace(/\s+/g, " ");
    const amount = Math.round(Number(itemAmountInput.value));
    const personIds = state.people
        .map((person) => person.id)
        .filter((id) => selectedForNewItem.has(id));

    if (!name) {
        setMessage(itemMessage, "Isi nama item dulu.");
        return;
    }

    if (!Number.isFinite(amount) || amount < 1) {
        setMessage(itemMessage, "Harga harus berupa rupiah lebih dari 0.");
        return;
    }

    if (personIds.length === 0) {
        setMessage(itemMessage, "Pilih minimal satu orang.");
        return;
    }

    state.items.push({ id: createId(), name, amount, personIds });
    itemNameInput.value = "";
    itemAmountInput.value = "";
    setMessage(itemMessage, "");
    saveState();
    render();
    itemNameInput.focus();
}

function removeItem(id) {
    state.items = state.items.filter((item) => item.id !== id);
    saveState();
    render();
}

function toggleItemPerson(itemId, personId) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) return;

    const selected = new Set(item.personIds);
    if (selected.has(personId)) {
        if (selected.size === 1) {
            setMessage(itemMessage, "Setiap item minimal dibagi ke satu orang.");
            return;
        }
        selected.delete(personId);
    } else {
        selected.add(personId);
    }

    item.personIds = state.people.map((person) => person.id).filter((id) => selected.has(id));
    setMessage(itemMessage, "");
    saveState();
    render();
}

function resetAll() {
    if (state.people.length === 0 && state.items.length === 0) return;
    const confirmed = window.confirm("Hapus semua peserta dan tagihan?");
    if (!confirmed) return;

    state.people = [];
    state.items = [];
    state.taxPercent = 0;
    state.servicePercent = 0;
    selectedForNewItem.clear();
    taxInput.value = "0";
    serviceInput.value = "0";
    setMessage(personMessage, "");
    setMessage(itemMessage, "");
    saveState();
    render();
}

function calculate() {
    const shares = Object.fromEntries(state.people.map((person) => [person.id, 0]));

    state.items.forEach((item) => {
        const ids = orderedPeople(item.personIds);
        if (ids.length === 0) return;
        const portions = splitEvenly(item.amount, ids);
        ids.forEach((id) => {
            shares[id] += portions[id];
        });
    });

    const subtotal = Object.values(shares).reduce((sum, value) => sum + value, 0);
    const tax = percentOf(subtotal, state.taxPercent);
    const service = percentOf(subtotal, state.servicePercent);
    const taxShares = distribute(tax, shares);
    const serviceShares = distribute(service, shares);

    const people = state.people.map((person) => ({
        id: person.id,
        name: person.name,
        items: shares[person.id],
        tax: taxShares[person.id],
        service: serviceShares[person.id],
        total: shares[person.id] + taxShares[person.id] + serviceShares[person.id]
    }));

    return {
        subtotal,
        tax,
        service,
        total: subtotal + tax + service,
        people
    };
}

function splitEvenly(amount, ids) {
    const base = Math.floor(amount / ids.length);
    let remainder = amount - base * ids.length;
    const portions = {};
    ids.forEach((id) => {
        portions[id] = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
    });
    return portions;
}

function distribute(total, weightsById) {
    const ids = state.people.map((person) => person.id);
    const result = Object.fromEntries(ids.map((id) => [id, 0]));
    const weights = ids.map((id) => weightsById[id] || 0);
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    if (total === 0 || weightSum === 0) return result;

    const raw = weights.map((weight) => (total * weight) / weightSum);
    const floors = raw.map((value) => Math.floor(value));
    let remainder = total - floors.reduce((sum, value) => sum + value, 0);
    const ranking = raw
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

    for (let step = 0; step < remainder; step += 1) {
        floors[ranking[step].index] += 1;
    }

    ids.forEach((id, index) => {
        result[id] = floors[index];
    });
    return result;
}

function orderedPeople(personIds) {
    const selected = new Set(personIds);
    return state.people.filter((person) => selected.has(person.id)).map((person) => person.id);
}

function percentOf(amount, percent) {
    return Math.round((amount * percent) / 100);
}

function render() {
    renderPeople();
    renderSplitOptions();
    renderItems();
    renderReceipt();
    addItemBtn.disabled = state.people.length === 0;
}

function renderPeople() {
    peopleList.replaceChildren();
    if (state.people.length === 0) {
        peopleList.append(note("Belum ada peserta."));
        return;
    }

    state.people.forEach((person) => {
        const chip = document.createElement("li");
        chip.className = "person-chip";
        chip.append(document.createTextNode(person.name));

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-btn";
        remove.setAttribute("aria-label", `Hapus ${person.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => removePerson(person.id));
        chip.append(remove);
        peopleList.append(chip);
    });
}

function renderSplitOptions() {
    splitOptions.replaceChildren();
    if (state.people.length === 0) {
        splitOptions.append(note("Tambahkan peserta untuk memilih pembagian."));
        return;
    }

    state.people.forEach((person) => {
        const label = document.createElement("label");
        label.className = "choice";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedForNewItem.has(person.id);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedForNewItem.add(person.id);
            else selectedForNewItem.delete(person.id);
        });

        label.append(checkbox, document.createTextNode(person.name));
        splitOptions.append(label);
    });
}

function renderItems() {
    itemList.replaceChildren();
    if (state.items.length === 0) {
        itemList.append(note("Belum ada item. Tambahkan tagihan pertama."));
        return;
    }

    state.items.forEach((item) => {
        const card = document.createElement("li");
        card.className = "item-card";

        const top = document.createElement("div");
        top.className = "item-top";

        const name = document.createElement("span");
        name.className = "item-name";
        name.textContent = item.name;

        const price = document.createElement("span");
        price.className = "item-price";
        price.textContent = formatRupiah(item.amount);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-btn";
        remove.setAttribute("aria-label", `Hapus ${item.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => removeItem(item.id));

        top.append(name, price, remove);

        const toggles = document.createElement("div");
        toggles.className = "split-options";
        const selected = new Set(item.personIds);

        state.people.forEach((person) => {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "share-toggle";
            toggle.textContent = person.name;
            toggle.setAttribute("aria-pressed", selected.has(person.id) ? "true" : "false");
            toggle.addEventListener("click", () => toggleItemPerson(item.id, person.id));
            toggles.append(toggle);
        });

        card.append(top, toggles);
        itemList.append(card);
    });
}

function renderReceipt() {
    const bill = calculate();
    receiptBody.replaceChildren();
    copyBtn.disabled = bill.people.length === 0 || bill.subtotal === 0;

    const totals = document.createElement("div");
    totals.className = "totals";
    totals.append(row("Subtotal", formatRupiah(bill.subtotal)));
    if (state.taxPercent > 0) {
        totals.append(row(`Pajak ${formatPercent(state.taxPercent)}`, formatRupiah(bill.tax)));
    }
    if (state.servicePercent > 0) {
        totals.append(row(`Layanan ${formatPercent(state.servicePercent)}`, formatRupiah(bill.service)));
    }

    const grand = document.createElement("div");
    grand.className = "grand";
    const grandLabel = document.createElement("span");
    grandLabel.textContent = "Total";
    const grandValue = document.createElement("strong");
    grandValue.textContent = formatRupiah(bill.total);
    grand.append(grandLabel, grandValue);
    totals.append(grand);
    receiptBody.append(totals);

    if (bill.people.length === 0) {
        receiptBody.append(note("Tambahkan peserta dan item untuk melihat pembagian."));
        return;
    }

    const shares = document.createElement("div");
    shares.className = "shares";

    bill.people.forEach((person) => {
        const block = document.createElement("article");
        block.className = "share";

        const title = document.createElement("h3");
        title.textContent = person.name;
        block.append(title);

        if (state.taxPercent > 0 || state.servicePercent > 0) {
            block.append(line("Item", formatRupiah(person.items)));
            if (state.taxPercent > 0) block.append(line("Pajak", formatRupiah(person.tax)));
            if (state.servicePercent > 0) block.append(line("Layanan", formatRupiah(person.service)));
        }

        const total = document.createElement("div");
        total.className = "share-total";
        const totalLabel = document.createElement("span");
        totalLabel.textContent = "Bayar";
        const totalValue = document.createElement("span");
        totalValue.textContent = formatRupiah(person.total);
        total.append(totalLabel, totalValue);
        block.append(total);
        shares.append(block);
    });

    receiptBody.append(shares);
}

function buildSummaryText() {
    const bill = calculate();
    const lines = ["Patungan", `Subtotal: ${formatRupiah(bill.subtotal)}`];
    if (state.taxPercent > 0) lines.push(`Pajak ${formatPercent(state.taxPercent)}: ${formatRupiah(bill.tax)}`);
    if (state.servicePercent > 0) lines.push(`Layanan ${formatPercent(state.servicePercent)}: ${formatRupiah(bill.service)}`);
    lines.push(`Total: ${formatRupiah(bill.total)}`, "");
    bill.people.forEach((person) => {
        lines.push(`${person.name}: ${formatRupiah(person.total)}`);
    });
    return lines.join("\n");
}

async function copySummary() {
    const bill = calculate();
    if (bill.people.length === 0 || bill.subtotal === 0) return;

    const text = buildSummaryText();
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            copyWithTextarea(text);
        }
        showToast("Ringkasan disalin.");
    } catch (error) {
        try {
            copyWithTextarea(text);
            showToast("Ringkasan disalin.");
        } catch (fallbackError) {
            showToast("Gagal menyalin. Salin teks ringkasan secara manual.");
        }
    }
}

function copyWithTextarea(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("copy failed");
}

function row(label, value) {
    return line(label, value, "row");
}

function line(label, value, className = "share-line") {
    const element = document.createElement("div");
    element.className = className;
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("span");
    valueNode.textContent = value;
    element.append(labelNode, valueNode);
    return element;
}

function note(text) {
    const element = document.createElement("p");
    element.className = "empty-note";
    element.textContent = text;
    return element;
}

function setMessage(element, text) {
    element.textContent = text;
}

function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function readPercent(input) {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) return 0;
    if (value > 100) return 100;
    return Math.round(value * 10) / 10;
}

function formatRupiah(value) {
    return `Rp ${new Intl.NumberFormat("id-ID").format(value)}`;
}

function formatPercent(value) {
    return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value)}%`;
}

function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        state.people = Array.isArray(saved.people) ? saved.people.filter(isPerson) : [];
        const knownIds = new Set(state.people.map((person) => person.id));
        state.items = Array.isArray(saved.items)
            ? saved.items.filter(isItem).map((item) => ({
                ...item,
                personIds: item.personIds.filter((id) => knownIds.has(id))
            }))
            : [];
        state.taxPercent = clampPercent(saved.taxPercent);
        state.servicePercent = clampPercent(saved.servicePercent);
    } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
    }
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function isPerson(value) {
    return value && typeof value.id === "string" && typeof value.name === "string";
}

function isItem(value) {
    return value
        && typeof value.id === "string"
        && typeof value.name === "string"
        && Number.isInteger(value.amount)
        && value.amount > 0
        && Array.isArray(value.personIds);
}

function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    if (number > 100) return 100;
    return Math.round(number * 10) / 10;
}
