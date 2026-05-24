// Replace fetchTwelveData in App.jsx with this:
const fetchTwelveData = useCallback(async () => {
  try {
    const res = await fetch("/api/prices");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setPrices({
      WTI:   { price: data.WTI.price,   change: data.WTI.change,   changePct: data.WTI.changePct,   loading: false },
      US100: { price: data.US100.price, change: data.US100.change, changePct: data.US100.changePct, loading: false },
    });
    setCandles({ WTI: data.WTI.candles, US100: data.US100.candles });
  } catch (e) {
    setPriceError(e.message);
  }
}, []);

// Replace sendWhatsApp with this:
const sendWhatsApp = async (signal) => {
  try {
    const res = await fetch("/api/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal }),
    });
    const data = await res.json();
    setWhatsappSent({ id: signal.id, status: data.ok ? "ok" : "error", msg: data.ok ? "Sent!" : data.error });
  } catch {
    setWhatsappSent({ id: signal.id, status: "error", msg: "Network error." });
  }
  setTimeout(() => setWhatsappSent(null), 4000);
};
