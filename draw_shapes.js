function createNestedShapesImage({ width = 420, height = 420 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;

  function drawOctagon() {
    ctx.beginPath();
    const radius = 150;
    for (let i = 0; i < 8; i += 1) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 4;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#dbeafe';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawTriangle() {
    ctx.beginPath();
    ctx.moveTo(centerX, 80);
    ctx.lineTo(90, 340);
    ctx.lineTo(330, 340);
    ctx.closePath();
    ctx.fillStyle = '#fde68a';
    ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawSquare() {
    ctx.fillStyle = '#bbf7d0';
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 2;
    ctx.fillRect(160, 150, 100, 100);
    ctx.strokeRect(160, 150, 100, 100);
  }

  function drawCircle() {
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#fca5a5';
    ctx.fill();
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawOctagon();

  ctx.save();
  drawTriangle();
  ctx.clip();

  ctx.save();
  drawSquare();
  ctx.clip();

  drawCircle();
  ctx.restore();
  ctx.restore();

  return canvas;
}

function attachNestedShapesToPage() {
  const canvas = createNestedShapesImage();
  const wrapper = document.createElement('div');
  wrapper.style.textAlign = 'center';

  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.alt = 'עיגול בתוך ריבוע בתוך משולש בתוך מתומן';
  img.style.border = '1px solid #cbd5e1';
  img.style.borderRadius = '12px';
  img.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.12)';

  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'nested-shapes.png';
  link.textContent = 'הורד את התמונה';
  link.style.display = 'inline-block';
  link.style.marginTop = '12px';
  link.style.padding = '10px 14px';
  link.style.background = '#2563eb';
  link.style.color = 'white';
  link.style.borderRadius = '8px';
  link.style.textDecoration = 'none';

  wrapper.appendChild(img);
  wrapper.appendChild(link);
  document.body.appendChild(wrapper);
}

if (typeof document !== 'undefined') {
  attachNestedShapesToPage();
}
