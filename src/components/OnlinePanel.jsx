import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { sessionLinks } from '../lib/api.js';

function QrCode({ text }) {
  const src = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(5, 2);
  }, [text]);
  return <img className="qr" src={src} alt="QR code à scanner avec le téléphone embarqué" />;
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt('Copiez ce lien :', text);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return <button className="small" onClick={copy}>{done ? '✓ Copié' : label}</button>;
}

/**
 * Hors ligne : créer ou rejoindre une course en ligne.
 * En ligne : état de la liaison, QR code du téléphone, liens pour d'autres PC.
 */
export default function OnlinePanel({ online, status, apiKind, circuit, onCreate, onJoin, onLeave }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [, force] = useState(0);
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [online]);

  const localNote = apiKind === 'local' && (
    <p className="warn small">
      Serveur non configuré : <b>mode test local</b>. La course n'est visible que dans ce navigateur
      (autres onglets). Pour le téléphone et les autres PC, configurez Supabase (voir README).
    </p>
  );

  if (!online) {
    const create = async (e) => {
      e.preventDefault();
      if (!circuit?.startFinish && !confirm('Ce circuit n\'a pas de ligne de départ/arrivée : pas de chrono. Créer quand même ?')) return;
      setBusy(true);
      setMsg('');
      try {
        await onCreate(name.trim() || circuit?.name || 'Course');
      } catch (err) {
        setMsg(err.message);
      } finally {
        setBusy(false);
      }
    };
    const join = (e) => {
      e.preventDefault();
      if (!onJoin(link.trim())) setMsg('Lien non reconnu. Collez le lien « stand » ou « spectateur » complet.');
    };
    return (
      <div className="card">
        <div className="card-title">Course en ligne (téléphone embarqué)</div>
        {localNote}
        <form className="search" onSubmit={create}>
          <input placeholder={`Nom de l'équipe / course (ex. ${circuit?.name ?? 'Équipe 12'})`} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Création…' : 'Créer'}</button>
        </form>
        <p className="muted small">Utilise le circuit actif « {circuit?.name} ». L'historique est gardé sur le serveur.</p>
        <form className="search" onSubmit={join}>
          <input placeholder="… ou collez un lien de course pour la reprendre" value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="submit" disabled={!link.trim()}>Rejoindre</button>
        </form>
        {msg && <p className="tx-errtxt small">{msg}</p>}
      </div>
    );
  }

  const links = sessionLinks(online.sid, online.key);
  const now = Date.now();
  const lastPtAge = status?.lastPointWall ? Math.round((now - status.lastPointWall) / 1000) : null;
  const phase = status?.phase ?? 'loading';
  const phaseTxt = {
    loading: `Chargement de l'historique… ${status?.count ? status.count + ' points' : ''}`,
    live: 'Connecté',
    offline: 'Serveur injoignable, nouvelle tentative…',
    error: status?.error || 'Erreur',
  }[phase];

  return (
    <div className="card online">
      <div className="card-title">
        Course en ligne <b>{status?.name || ''}</b>
        <span className="spacer" />
        <span className={`tag ${phase === 'live' ? 'ok' : 'bad'}`}>{phase === 'live' ? 'en ligne' : phase === 'loading' ? '…' : 'hors ligne'}</span>
      </div>
      {localNote}
      <p className="small">
        {phaseTxt}
        {phase === 'live' && (
          <> · {status.count} points reçus{lastPtAge != null && <> · dernier il y a {lastPtAge} s</>}</>
        )}
        {phase === 'offline' && status?.error && <span className="muted"> ({status.error})</span>}
      </p>
      {!online.key && <p className="muted small">Accès spectateur : lecture seule.</p>}

      {links.phone && (
        <details className="pair" open={!status?.count}>
          <summary>📱 Appairer le téléphone embarqué</summary>
          <div className="pair-body">
            <QrCode text={links.phone} />
            <div className="small">
              <p>Scannez ce QR code avec l'appareil photo du téléphone, ouvrez le lien puis touchez « Démarrer l'émission ».</p>
              <CopyButton text={links.phone} label="Copier le lien téléphone" />
            </div>
          </div>
        </details>
      )}

      <div className="sim-row wrap">
        {links.stand && <CopyButton text={links.stand} label="Copier le lien stand (autre PC)" />}
        <CopyButton text={links.viewer} label="Copier le lien spectateur" />
        <span className="spacer" />
        <button className="small danger ghost" onClick={onLeave}>Quitter la course</button>
      </div>
      <p className="muted small">
        Gardez le lien stand en lieu sûr : il permet de reprendre la course sur n'importe quel PC, avec tout l'historique.
      </p>
    </div>
  );
}
