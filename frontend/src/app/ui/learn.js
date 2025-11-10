import { on, debounce } from '../../lib/events.js';

export function initLearnCarousel() {
  const track = document.querySelector('.learn__track[data-learn-track]');
  const prev = document.querySelector('[data-learn-prev]');
  const next = document.querySelector('[data-learn-next]');
  const chips = Array.from(document.querySelectorAll('.learn-card .chip[data-snippet]'));
  if (!track) return;

  const cards = Array.from(track.querySelectorAll('.learn-card'));

  const updateCardStates = () => {
    if (!cards.length) return;
    const trackRect = track.getBoundingClientRect();
    const centerX = trackRect.left + trackRect.width / 2;

    let closestIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.left + rect.width / 2;
      const distance = Math.abs(cardCenter - centerX);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    cards.forEach((card, index) => {
      card.classList.add('is-visible');
      card.classList.toggle('is-active', index === closestIndex);
      card.classList.toggle('is-near', Math.abs(index - closestIndex) === 1);
    });
  };

  const scheduleUpdate = debounce(updateCardStates, 16);

  updateCardStates();

  on(prev, 'click', (e) => {
    e.preventDefault();
    track.scrollBy({ left: -Math.round(track.clientWidth * 0.9), behavior: 'smooth' });
    scheduleUpdate();
  });
  on(next, 'click', (e) => {
    e.preventDefault();
    track.scrollBy({ left: Math.round(track.clientWidth * 0.9), behavior: 'smooth' });
    scheduleUpdate();
  });
  on(track, 'scroll', scheduleUpdate);
  on(window, 'resize', scheduleUpdate);
  chips.forEach((chip) => {
    on(chip, 'click', (e) => {
      e.preventDefault();
      const snippet = chip.getAttribute('data-snippet') || '';
      try {
        navigator.clipboard?.writeText?.(snippet);
      } catch {}
      const link = document.createElement('a');
      link.href = '/graph';
      link.click();
    });
  });
}

