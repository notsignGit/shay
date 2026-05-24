function createTrussCanvas({ width = 420, height = 420 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  const pad = 40;
  const scale = 2.5;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  const points = {
    a: { x: pad, y: height - pad },
    b: { x: pad + 100 * scale, y: height - pad },
    c: { x: pad + 100 * scale, y: height - pad - 100 * scale },
    d: { x: pad, y: height - pad - 100 * scale },
  };

  function line(p1, p2) {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  line(points.a, points.b);
  line(points.b, points.c);
  line(points.c, points.d);
  line(points.a, points.c);
  line(points.d, points.b);

  ctx.fillStyle = '#1f2937';
  ctx.font = '16px Arial';
  ctx.fillText('A', points.a.x - 12, points.a.y + 22);
  ctx.fillText('B', points.b.x + 6, points.b.y + 22);
  ctx.fillText('C', points.c.x + 6, points.c.y - 8);
  ctx.fillText('D', points.d.x - 12, points.d.y - 8);

  return canvas;
}

function renderTruss() {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '12px';
  container.style.padding = '24px';
  container.style.fontFamily = 'Arial, sans-serif';

  const title = document.createElement('h1');
  title.textContent = 'מסבך';
  title.style.margin = '0';

  const canvas = createTrussCanvas();
  const note = document.createElement('p');
  note.textContent = 'המסבך מורכב מחמש מוטות: AB, BC, CD, AC, DB';
  note.style.margin = '0';

  container.appendChild(title);
  container.appendChild(canvas);
  container.appendChild(note);

  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.style.background = '#f3f4f6';
  document.body.appendChild(container);
}

if (typeof document !== 'undefined') {
  renderTruss();
}
