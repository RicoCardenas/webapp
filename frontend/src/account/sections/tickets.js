import { requestWithAuth } from '../api-client.js';
import { ui } from '../ui.js';
import { on } from '../../lib/events.js';

const ticketsState = {
  bound: false,
  loading: false,
  page: 1,
  pageSize: 5,
  totalPages: 0,
};

const TICKET_TYPE_LABELS = {
  soporte: 'Soporte',
  rol: 'Rol',
  consulta: 'Consulta',
  otro: 'Otro',
};

const TICKET_STATUS_LABELS = {
  pendiente: 'Pendiente',
  atendida: 'Atendida',
  rechazada: 'Rechazada',
};

const ticketDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTicketDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return ticketDateFormatter.format(dt);
}

function formatTicketType(value) {
  const key = String(value || '').toLowerCase();
  if (TICKET_TYPE_LABELS[key]) return TICKET_TYPE_LABELS[key];
  if (!key) return 'General';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatTicketStatus(value) {
  const key = String(value || '').toLowerCase();
  if (TICKET_STATUS_LABELS[key]) return TICKET_STATUS_LABELS[key];
  if (!key) return 'Pendiente';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function setTicketsLoading(isLoading) {
  ticketsState.loading = Boolean(isLoading);
  if (ui.ticketsType instanceof HTMLSelectElement) ui.ticketsType.disabled = ticketsState.loading;
  if (ui.ticketsTitle instanceof HTMLInputElement) ui.ticketsTitle.disabled = ticketsState.loading;
  if (ui.ticketsDescription instanceof HTMLTextAreaElement) ui.ticketsDescription.disabled = ticketsState.loading;
  if (ui.ticketsSubmit instanceof HTMLButtonElement) ui.ticketsSubmit.disabled = ticketsState.loading;
  if (ui.ticketsPrev instanceof HTMLButtonElement) ui.ticketsPrev.disabled = ticketsState.loading || ticketsState.page <= 1;
  if (ui.ticketsNext instanceof HTMLButtonElement) ui.ticketsNext.disabled = ticketsState.loading || (ticketsState.totalPages > 0 && ticketsState.page >= ticketsState.totalPages);
}

function clearTicketFeedback() {
  if (!ui.ticketsFeedback) return;
  ui.ticketsFeedback.textContent = '';
  ui.ticketsFeedback.hidden = true;
  ui.ticketsFeedback.removeAttribute('data-variant');
}

function showTicketFeedback(message, variant = 'info') {
  if (!ui.ticketsFeedback) return;
  ui.ticketsFeedback.textContent = message;
  ui.ticketsFeedback.dataset.variant = variant;
  ui.ticketsFeedback.hidden = false;
}

function updateTicketsPagination(meta) {
  ticketsState.totalPages = Number(meta?.total_pages ?? ticketsState.totalPages ?? 0);
  const pageFromMeta = Number(meta?.page);
  if (!Number.isNaN(pageFromMeta) && pageFromMeta > 0) {
    ticketsState.page = pageFromMeta;
  }
  const sizeFromMeta = Number(meta?.page_size);
  if (!Number.isNaN(sizeFromMeta) && sizeFromMeta > 0) {
    ticketsState.pageSize = sizeFromMeta;
  }

  if (ui.ticketsPagination) {
    const hidden = ticketsState.totalPages <= 1 && ticketsState.page <= 1;
    ui.ticketsPagination.hidden = hidden;
  }
  if (ui.ticketsPageInfo) {
    const totalPages = ticketsState.totalPages || 1;
    const current = ticketsState.page || 1;
    ui.ticketsPageInfo.textContent = `Página ${current} de ${totalPages}`;
  }
  if (ui.ticketsPrev instanceof HTMLButtonElement) {
    ui.ticketsPrev.disabled = ticketsState.loading || ticketsState.page <= 1;
  }
  if (ui.ticketsNext instanceof HTMLButtonElement) {
    const atEnd = ticketsState.totalPages === 0 || ticketsState.page >= ticketsState.totalPages;
    ui.ticketsNext.disabled = ticketsState.loading || atEnd;
  }
}

function renderTickets(items) {
  if (!ui.ticketsList) return;
  ui.ticketsList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    if (ui.ticketsEmpty) {
      ui.ticketsEmpty.hidden = false;
      const message = ui.ticketsEmpty.querySelector('p');
      if (message) message.textContent = 'Aún no has enviado solicitudes.';
    }
    return;
  }

  if (ui.ticketsEmpty) ui.ticketsEmpty.hidden = true;

  items.forEach((ticket) => {
    const li = document.createElement('li');
    li.className = 'ticket-item';

    const header = document.createElement('div');
    header.className = 'ticket-item__header';

    const title = document.createElement('h4');
    title.className = 'ticket-item__title';
    title.textContent = ticket?.title || 'Solicitud';
    header.appendChild(title);

    const statusBadge = document.createElement('span');
    statusBadge.className = `ticket-status ticket-status--${ticket?.status || 'pendiente'}`;
    statusBadge.textContent = formatTicketStatus(ticket?.status);
    header.appendChild(statusBadge);

    li.appendChild(header);

    const typeLabel = document.createElement('p');
    typeLabel.className = 'ticket-item__type';
    typeLabel.textContent = `Tipo: ${formatTicketType(ticket?.type)}`;
    li.appendChild(typeLabel);

    if (ticket?.description) {
      const description = document.createElement('p');
      description.className = 'ticket-item__description';
      description.textContent = ticket.description;
      li.appendChild(description);
    }

    const meta = document.createElement('p');
    meta.className = 'ticket-item__meta';
    const createdLabel = formatTicketDate(ticket?.created_at);
    meta.textContent = createdLabel ? `Creado: ${createdLabel}` : 'Creado recientemente';
    li.appendChild(meta);

    ui.ticketsList.appendChild(li);
  });
}

async function loadTickets() {
  if (!ui.ticketsList) return;
  setTicketsLoading(true);
  clearTicketFeedback();

  try {
    const params = new URLSearchParams();
    params.set('page', String(ticketsState.page));
    params.set('page_size', String(ticketsState.pageSize));

    const res = await requestWithAuth(`/api/account/requests?${params.toString()}`);
    if (!res) return;

    if (!res.ok) {
      showTicketFeedback('No se pudieron cargar tus solicitudes.', 'error');
      renderTickets([]);
      return;
    }

    const payload = await res.json().catch(() => ({}));
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const meta = payload?.meta || {};
    updateTicketsPagination(meta);
    renderTickets(items);
  } finally {
    setTicketsLoading(false);
  }
}

async function handleTicketSubmit(event) {
  event.preventDefault();
  if (ticketsState.loading) return;
  if (!(ui.ticketsType instanceof HTMLSelectElement)) return;
  if (!(ui.ticketsTitle instanceof HTMLInputElement)) return;
  if (!(ui.ticketsDescription instanceof HTMLTextAreaElement)) return;

  const payload = {
    type: ui.ticketsType.value.trim().toLowerCase(),
    title: ui.ticketsTitle.value.trim(),
    description: ui.ticketsDescription.value.trim(),
  };

  if (!payload.type || !payload.title || payload.description.length < 10) {
    showTicketFeedback('Revisa el tipo, título y describe tu solicitud con más detalle.', 'error');
    return;
  }

  setTicketsLoading(true);
  clearTicketFeedback();

  try {
    const res = await requestWithAuth('/api/account/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res) return;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorMsg = data?.error || 'No se pudo registrar tu solicitud.';
      showTicketFeedback(errorMsg, 'error');
      return;
    }

    showTicketFeedback(data?.message || 'Solicitud enviada correctamente.', 'success');
    if (ui.ticketsForm) ui.ticketsForm.reset();
    ticketsState.page = 1;
    await loadTickets();
  } catch (err) {
    console.error('[account] Error al crear solicitud', err);
    showTicketFeedback('No se pudo registrar tu solicitud. Intenta de nuevo más tarde.', 'error');
  } finally {
    setTicketsLoading(false);
  }
}

function handleTicketsPrev(event) {
  event.preventDefault();
  if (ticketsState.loading) return;
  if (ticketsState.page <= 1) return;
  ticketsState.page -= 1;
  loadTickets();
}

function handleTicketsNext(event) {
  event.preventDefault();
  if (ticketsState.loading) return;
  if (ticketsState.totalPages && ticketsState.page >= ticketsState.totalPages) return;
  ticketsState.page += 1;
  loadTickets();
}

function bindTicketsSection() {
  if (ticketsState.bound) return;
  ticketsState.bound = true;

  if (ui.ticketsForm) {
    on(ui.ticketsForm, 'submit', handleTicketSubmit);
  }
  if (ui.ticketsPrev) {
    on(ui.ticketsPrev, 'click', handleTicketsPrev);
  }
  if (ui.ticketsNext) {
    on(ui.ticketsNext, 'click', handleTicketsNext);
  }
}

function resetTickets() {
  ticketsState.page = 1;
  ticketsState.totalPages = 0;
  ticketsState.loading = false;
  if (ui.ticketsList) ui.ticketsList.replaceChildren();
  if (ui.ticketsEmpty) {
    ui.ticketsEmpty.hidden = false;
    const message = ui.ticketsEmpty.querySelector('p');
    if (message) message.textContent = 'Aún no has enviado solicitudes.';
  }
  if (ui.ticketsPagination) ui.ticketsPagination.hidden = true;
  if (ui.ticketsPrev instanceof HTMLButtonElement) ui.ticketsPrev.disabled = true;
  if (ui.ticketsNext instanceof HTMLButtonElement) ui.ticketsNext.disabled = true;
  if (ui.ticketsPageInfo) ui.ticketsPageInfo.textContent = 'Página 1 de 1';
  if (ui.ticketsForm) ui.ticketsForm.reset();
  if (ui.ticketsFeedback) {
    ui.ticketsFeedback.textContent = '';
    ui.ticketsFeedback.hidden = true;
    ui.ticketsFeedback.removeAttribute('data-variant');
  }
}

export function createTicketsSection() {
  return {
    init: bindTicketsSection,
    load: loadTickets,
    reset: resetTickets,
  };
}
