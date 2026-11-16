// HUD: every DOM element the player sees, in one place. The game calls setters;
// nothing here reads game state. The minimap is a 2D canvas drawn top-down from
// the map data, with the player, teammates, the bomb and spotted enemies. New in
// this pass: a damage-direction arc that shows where the last hit came from, a
// plant/defuse progress bar, and a round-end summary so the player always knows
// why the round ended and what it paid.
export function createHud(map) {
  const $ = (id) => document.getElementById(id);
  const els = {
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    hpNum: $('hp-num'), hpBar: $('hp-bar'), armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    money: $('money'), timer: $('timer'),
    scoreA: $('score-a'), scoreB: $('score-b'),
    roundLabel: $('round-label'), bombStatus: $('bomb-status'),
    killfeed: $('killfeed'), banner: $('banner'), bannerText: $('banner-text'), bannerSub: $('banner-sub'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buyMenu: $('buy-menu'), buyList: $('buy-list'), buyMoney: $('buy-money'),
    vignette: $('vignette'), flash: $('flash'), scope: $('scope'),
    minimap: $('minimap'), weaponName: $('weapon-name'), grenadeLine: $('grenade-line'),
    dmgDir: $('dmg-dir'), progress: $('progress'), progressBar: $('progress-bar'),
    progressLabel: $('progress-label'), summary: $('round-summary'), summaryLines: $('summary-lines'),
    healthBox: $('health-box'),
  };
  const mm = els.minimap.getContext('2d');
  let hitTimer = null;
  let bannerTimer = null;
  let dmgTimer = null;
  let summaryTimer = null;

  function drawMinimap(player, bots, bomb, sites, smokes) {
    const W = 168, H = 126;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(16,18,22,0.72)';
    mm.fillRect(0, 0, W, H);
    const sx = (x) => ((x + 32) / 64) * W;
    const sz = (z) => ((z + 24) / 48) * H;
    // Walls.
    mm.fillStyle = '#8a6f52';
    for (const b of map.colliders) {
      if (b.max.y > 2) {
        mm.fillRect(sx(b.min.x), sz(b.min.z), Math.max(1, sx(b.max.x) - sx(b.min.x)), Math.max(1, sz(b.max.z) - sz(b.min.z)));
      }
    }
    // Smoke clouds, so the player can plan around them.
    if (smokes) {
      mm.fillStyle = 'rgba(200,200,200,0.35)';
      for (const s of smokes) {
        mm.beginPath(); mm.arc(sx(s.x), sz(s.z), (s.r / 64) * W, 0, 7); mm.fill();
      }
    }
    // Sites.
    for (const s of Object.values(sites)) {
      mm.strokeStyle = '#f0a830'; mm.lineWidth = 1.5;
      mm.strokeRect(sx(s.minX), sz(s.minZ), sx(s.maxX) - sx(s.minX), sz(s.maxZ) - sz(s.minZ));
      mm.fillStyle = '#f0a830'; mm.font = 'bold 11px system-ui';
      mm.fillText(s.name, sx(s.center.x) - 3, sz(s.center.z) + 4);
    }
    // Bomb: red diamond when dropped or planted.
    if (bomb.state.status === 'dropped' || bomb.state.status === 'planted') {
      mm.fillStyle = '#e5484d';
      mm.save();
      mm.translate(sx(bomb.state.pos.x), sz(bomb.state.pos.z));
      mm.rotate(Math.PI / 4);
      mm.fillRect(-3.5, -3.5, 7, 7);
      mm.restore();
    }
    // Bots: teammates teal with a facing tick, enemies amber only when
    // recently seen. The bomb carrier gets a white ring.
    for (const b of bots) {
      if (!b.alive) continue;
      const isFriend = b.team === 'attack';
      mm.fillStyle = isFriend ? '#2ec4b6' : '#f0a830';
      mm.beginPath(); mm.arc(sx(b.pos.x), sz(b.pos.z), 3, 0, 7); mm.fill();
      if (isFriend) {
        mm.strokeStyle = '#efe8d8'; mm.lineWidth = 1;
        mm.beginPath();
        mm.moveTo(sx(b.pos.x), sz(b.pos.z));
        mm.lineTo(sx(b.pos.x) + Math.sin(b.yaw) * 6, sz(b.pos.z) + Math.cos(b.yaw) * 6);
        mm.stroke();
      }
      if (b.carryingBomb) {
        mm.strokeStyle = '#efe8d8'; mm.lineWidth = 1.5;
        mm.beginPath(); mm.arc(sx(b.pos.x), sz(b.pos.z), 5.5, 0, 7); mm.stroke();
      }
    }
    // Player arrow.
    mm.save();
    mm.translate(sx(player.position.x), sz(player.position.z));
    mm.rotate(-player.yaw);
    mm.fillStyle = '#efe8d8';
    mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4.5, 5); mm.lineTo(-4.5, 5); mm.closePath(); mm.fill();
    mm.restore();
  }

  return {
    setHealth(hp, armor) {
      els.hpNum.textContent = Math.max(0, Math.ceil(hp));
      els.hpBar.style.width = `${Math.max(0, hp)}%`;
      els.hpBar.style.background = hp > 50 ? '#2ec4b6' : hp > 25 ? '#f0a830' : '#e5484d';
      els.armorNum.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
      els.healthBox.classList.toggle('critical', hp > 0 && hp <= 25);
    },
    setAmmo(mag, reserve) {
      els.ammoMag.textContent = mag;
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(m) { els.money.textContent = `$${m}`; },
    setTimer(sec, phase) {
      const s = Math.max(0, Math.ceil(sec));
      els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.timer.style.color = sec <= 10 && phase === 'live' ? '#e5484d' : '';
    },
    setScore(a, b) { els.scoreA.textContent = a; els.scoreB.textContent = b; },
    setRound(n) { els.roundLabel.textContent = `ROUND ${n}`; },
    setBomb(text, danger) {
      els.bombStatus.textContent = text;
      els.bombStatus.style.color = danger ? '#e5484d' : '';
    },
    setCrosshair(gap) {
      els.crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(kill, head = false) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      els.hitmarker.classList.toggle('head', head);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill', 'head'), 110);
    },
    // A red arc at the screen edge pointing at the shooter, so the player
    // learns where the damage came from instead of guessing.
    damageDirection(angleDeg) {
      if (!els.dmgDir) return;
      els.dmgDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
      els.dmgDir.classList.add('on');
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => els.dmgDir.classList.remove('on'), 900);
    },
    damageFlash(strength) {
      els.vignette.style.opacity = String(Math.min(0.85, 0.35 + strength * 0.4));
      setTimeout(() => { els.vignette.style.opacity = '0'; }, 260);
    },
    flashBlind(strength) {
      els.flash.style.opacity = String(Math.min(1, strength));
      setTimeout(() => { els.flash.style.opacity = '0'; }, 420);
    },
    // Plant / defuse progress: a thin bar under the crosshair with a label.
    setProgress(frac, label) {
      if (!els.progress) return;
      if (frac <= 0) { els.progress.classList.add('hidden'); return; }
      els.progress.classList.remove('hidden');
      els.progressBar.style.width = `${Math.round(frac * 100)}%`;
      els.progressLabel.textContent = label;
    },
    killfeed(text, friendly) {
      const div = document.createElement('div');
      div.className = 'feed-line' + (friendly ? ' friendly' : '');
      div.textContent = text;
      els.killfeed.prepend(div);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => div.remove(), 5200);
    },
    banner(text, sub, ms = 2600) {
      els.bannerText.textContent = text;
      els.bannerSub.textContent = sub ?? '';
      els.banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.add('hidden'), ms);
    },
    // Round-end summary: why the round ended and what it paid, shown under
    // the banner for a few seconds.
    roundSummary(lines, ms = 4200) {
      if (!els.summary) return;
      els.summaryLines.innerHTML = '';
      for (const line of lines) {
        const div = document.createElement('div');
        div.textContent = line;
        els.summaryLines.appendChild(div);
      }
      els.summary.classList.remove('hidden');
      clearTimeout(summaryTimer);
      summaryTimer = setTimeout(() => els.summary.classList.add('hidden'), ms);
    },
    showOverlay(kind, data = {}) {
      els.overlay.hidden = false;
      if (kind === 'start') {
        els.overlayTitle.textContent = 'DUSTFALL';
        els.overlayCopy.textContent = 'Meridian Relay — a 5v5 tactical round. Plant the device at Relay or Silo, or wipe the Wardens. Click to play.';
        els.play.textContent = 'Click to play';
      } else if (kind === 'paused') {
        els.overlayTitle.textContent = 'Paused';
        els.overlayCopy.textContent = 'Click to resume. Buy with B during the buy phase.';
        els.play.textContent = 'Resume';
      } else if (kind === 'end') {
        els.overlayTitle.textContent = data.title ?? 'Round over';
        els.overlayCopy.textContent = data.copy ?? '';
        els.play.textContent = 'Play again';
      } else if (kind === 'match') {
        els.overlayTitle.textContent = data.title ?? 'Match over';
        els.overlayCopy.textContent = data.copy ?? '';
        els.play.textContent = 'Play again';
      }
    },
    hideOverlay() { els.overlay.hidden = true; },
    onPlay(fn) { els.play.addEventListener('click', fn); },
    showBuy(items, money) {
      els.buyMoney.textContent = `$${money}`;
      els.buyList.innerHTML = '';
      for (const it of items) {
        const row = document.createElement('div');
        row.className = 'buy-row' + (money < it.price ? ' poor' : '');
        row.innerHTML = `<span class="buy-key">${it.key}</span><span class="buy-name">${it.label}</span><span class="buy-price">$${it.price}</span>`;
        els.buyList.appendChild(row);
      }
      els.buyMenu.classList.remove('hidden');
    },
    hideBuy() { els.buyMenu.classList.add('hidden'); },
    setWeapon(name, grenades) {
      els.weaponName.textContent = name.toUpperCase();
      const parts = [];
      if (grenades.frag) parts.push(`Frag ×${grenades.frag}`);
      if (grenades.smoke) parts.push(`Smoke ×${grenades.smoke}`);
      if (grenades.flash) parts.push(`Flash ×${grenades.flash}`);
      els.grenadeLine.textContent = parts.length ? `Grenades: ${parts.join('  ')}` : 'Grenades: —';
    },
    setScope(on) { els.scope.classList.toggle('hidden', !on); },
    minimap(player, bots, bomb, sites, smokes) { drawMinimap(player, bots, bomb, sites, smokes); },
  };
}
