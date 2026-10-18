/**
 * xml.mjs — Parser de XML mínimo, sin dependencias.
 *
 * No es un parser general. Solo sabe lo justo para el XML del BOE, que es
 * plano y regular: sin atributos namespaces raros, sin CDATA complejo, sin
 * entidades más allá de las cinco básicas. A cambio pesa 80 líneas y no
 * añade un `node_modules` al proyecto.
 *
 * Devuelve objetos anidados. Cuando el mismo nombre de etiqueta aparece más
 * de una vez bajo el mismo padre, colapsa en un array — que es el 90% de los
 * casos que importan aquí (varios <item>, varios <materia>).
 */

const ENTIDADES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function desescapar(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m]);
}

/**
 * @param {string} xml
 * @returns {Record<string, any>} el árbol, con la etiqueta raíz como clave.
 */
export function xml2jsonlite(xml) {
  const raiz = { children: [], text: '' };

  // Tokeniza en orden: apertura, cierre, texto.
  //
  // El patrón de apertura tiene que admitir atributos, y no puede hacerlo con
  // un `[^>]*` a secas: un `>` puede ir dentro de una comilla de atributo. Por
  // eso el cuerpo es una alternancia que respeta las cadenas. Es el detalle
  // que hace que un parser «corto» de XML devuelva `{}` sin lanzar ningún
  // error, que es la peor forma de romperse.
  const pila = [raiz];
  const re = /<([^\s!?/>]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>|<\/([^\s>]+)>|([^<]+)/g;
  let m;

  while ((m = re.exec(xml)) !== null) {
    const [todo, apertura, cuerpo, cierre, texto] = m;

    if (apertura) {
      const nombre = apertura.replace(/^.*:/, ''); // quita namespace
      const nodo = { tag: nombre, children: [], text: '', attrs: {} };
      for (const a of cuerpo.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
        nodo.attrs[a[1]] = a[2];
      }

      const padre = pila[pila.length - 1];
      padre.children.push(nodo);
      // `<tag/>` no abre nada, así que se resuelve en el acto.
      if (!/\/\s*$/.test(cuerpo)) pila.push(nodo);
    } else if (cierre) {
      const nombre = cierre.replace(/^.*:/, '');
      // Retrocede hasta cerrar esta etiqueta (protege si el anidado no cuadra).
      for (let i = pila.length - 1; i > 0; i--) {
        if (pila[i].tag === nombre) {
          const nodo = pila.pop();
          nodo.text = nodo.text.trim();
          break;
        }
      }
    } else if (texto) {
      const padre = pila[pila.length - 1];
      padre.text += desescapar(texto);
    }
  }

  // Colapsa a la forma final: { etiqueta: valor | [..] | { etiqueta: ... } }.
  return colapsar(raiz).documento ?? {};
}

/** Convierte la lista plana de nodos en un árbol de objetos-valor. */
function colapsar(nodo) {
  const salida = {};
  for (const hijo of nodo.children) {
    const nombre = hijo.tag;
    const valor = hijo.children.length > 0 ? colapsar(hijo) : hijo.text;

    if (nombre in salida) {
      if (Array.isArray(salida[nombre])) salida[nombre].push(valor);
      else salida[nombre] = [salida[nombre], valor];
    } else {
      salida[nombre] = valor;
    }
  }
  return salida;
}