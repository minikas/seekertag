const dialog = document.querySelector("#download-dialog");

const copy = {
  pt: { nav:["Como funciona","Por que SeekerTag","Dúvidas"], cta:"Conheça o app", hero:["O que é seu.","De volta","para você."], lead:"As coisas se perdem. A conexão, não.", lead2:"Uma etiqueta inteligente para aproximar quem perdeu de quem pode fazer a diferença.", primary:"Encontre seu caminho de volta", secondary:"Veja como funciona", how:["Perder faz parte.","Reencontrar também pode."], howLead:"Sem complicar o seu dia. Uma conexão que começa com uma etiqueta.", steps:[["Etiquete o que importa.","Cadastre seu objeto no app. Imprima o QR ou grave uma etiqueta NFC e leve essa conexão com você."],["Alguém encontra. Vocês se conectam.","Quem encontrar escaneia a etiqueta pelo SeekerTag e manda uma mensagem. Não precisa criar conta nem ver seus contatos."],["Combine um final feliz.","Conversem pelo app, combinem a entrega e confirme a devolução. O que é seu volta a fazer parte da sua história."]], faq:["Pequenas dúvidas.","Respostas diretas."], closing:["Algumas coisas","merecem voltar."], closingLead:"Comece com uma etiqueta. Deixe o próximo capítulo em aberto.", dialog:["Olá, Seeker.","O SeekerTag está em desenvolvimento para Android, com foco no Solana Seeker. O download público ainda não está disponível."] },
  en: { nav:["How it works","Why SeekerTag","Questions"], cta:"Meet the app", hero:["What is yours.","Back","to you."], lead:"Things get lost. Connection doesn't.", lead2:"One smart tag brings together the person who lost something and the person who can help.", primary:"Find your way back", secondary:"See how it works", how:["Losing things happens.","Finding them again can too."], howLead:"No extra friction. A connection that starts with one small tag.", steps:[["Tag what matters.","Add your object in the app. Print a QR code or write an NFC tag and carry that connection with you."],["Someone finds it. You connect.","The finder scans the tag with SeekerTag and sends a message. No account or contact details required."],["Make it a happy ending.","Talk in the app, arrange the handoff and confirm the return. What is yours becomes part of your story again."]], faq:["A few questions.","Straight answers."], closing:["Some things","deserve to come back."], closingLead:"Start with a tag. Leave the next chapter open.", dialog:["Hello, Seeker.","SeekerTag is in development for Android, with a focus on Solana Seeker. The public download is not available yet."] },
  es: { nav:["Cómo funciona","Por qué SeekerTag","Dudas"], cta:"Conoce la app", hero:["Lo que es tuyo.","De vuelta","para ti."], lead:"Las cosas se pierden. La conexión, no.", lead2:"Una etiqueta inteligente acerca a quien perdió algo y a quien puede ayudar.", primary:"Encuentra el camino de vuelta", secondary:"Mira cómo funciona", how:["Perder algo pasa.","Volver a encontrarlo también puede."], howLead:"Sin complicar tu día. Una conexión que empieza con una etiqueta.", steps:[["Etiqueta lo que importa.","Registra tu objeto en la app. Imprime el QR o graba una etiqueta NFC y lleva esa conexión contigo."],["Alguien lo encuentra. Ustedes conectan.","Quien lo encuentre escanea la etiqueta con SeekerTag y envía un mensaje. No necesita crear una cuenta."],["Lleguen a un final feliz.","Hablen en la app, acuerden la entrega y confirma la devolución. Lo que es tuyo vuelve a tu historia."]], faq:["Unas pequeñas dudas.","Respuestas directas."], closing:["Algunas cosas","merecen volver."], closingLead:"Empieza con una etiqueta. Deja abierto el próximo capítulo.", dialog:["Hola, Seeker.","SeekerTag está en desarrollo para Android, con foco en Solana Seeker. La descarga pública aún no está disponible."] }
};

const text = (selector, value) => {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
};

const setLanguage = (language) => {
  const t = copy[language] || copy.pt;
  document.documentElement.lang = language === "pt" ? "pt-BR" : language;
  document.querySelector("#language-select").value = language;
  document.querySelectorAll(".header nav a").forEach((link, index) => { link.textContent = t.nav[index]; });
  text(".header [data-download]", t.cta);
  document.querySelector("#hero-title").innerHTML = t.hero[0] + "<br />" + t.hero[1] + '<br /><span class="hero-highlight">' + t.hero[2] + "</span>";
  document.querySelector(".hero-copy > p").innerHTML = t.lead + "<br />" + t.lead2;
  text(".hero-actions .button", t.primary);
  text(".text-link", t.secondary);
  document.querySelector(".how h2").innerHTML = t.how[0] + '<br /><span class="muted">' + t.how[1] + "</span>";
  text(".section-head p", t.howLead);
  document.querySelectorAll(".steps article").forEach((article, index) => { article.querySelector("h3").textContent = t.steps[index][0]; article.querySelector("p").textContent = t.steps[index][1]; });
  document.querySelector(".faq h2").innerHTML = t.faq[0] + '<br /><span>' + t.faq[1] + "</span>";
  document.querySelector(".closing h2").innerHTML = t.closing[0] + '<br /><span>' + t.closing[1] + "</span>";
  text(".closing p", t.closingLead);
  text("#dialog-title", t.dialog[0]);
  text("#download-dialog p", t.dialog[1]);
  localStorage.setItem("seekertag-language", language);
};

const languageSelect = document.querySelector("#language-select");
languageSelect.addEventListener("change", (event) => setLanguage(event.target.value));
setLanguage(localStorage.getItem("seekertag-language") || "pt");

document
  .querySelectorAll("[data-download]")
  .forEach((button) =>
    button.addEventListener("click", () => dialog.showModal()),
  );
document
  .querySelector(".close-dialog")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  const box = dialog.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    dialog.close();
});
document.querySelector("#year").textContent = new Date().getFullYear();
