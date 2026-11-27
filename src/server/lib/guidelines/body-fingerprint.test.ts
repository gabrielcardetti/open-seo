import { describe, expect, it } from "vitest";
import {
  bodyShingleFingerprint,
  clusterBodyOverlap,
  jaccardOverlap,
} from "./body-fingerprint";

const BOILERPLATE_CALENDAR =
  "El calendario laboral del municipio incluye catorce dias festivos retribuidos y no recuperables a lo largo del ano natural. De ellos doce corresponden a festivos nacionales y autonomicos fijados por el decreto del gobierno vasco y los dos restantes corresponden a fiestas locales aprobadas por el ayuntamiento. Cuando un festivo cae en domingo el descanso puede trasladarse al lunes siguiente segun el acuerdo anual del consejo de gobierno. Consulta ademas el calendario escolar y las fechas habiles para plazos administrativos en la comunidad autonoma.";

describe("bodyShingleFingerprint & jaccardOverlap", () => {
  it("returns empty fingerprint for very short pages", () => {
    expect(bodyShingleFingerprint("Hola mundo corto")).toEqual([]);
  });

  it("measures high overlap on city-swap boilerplate pages even when word counts differ", () => {
    const bilbao = `${BOILERPLATE_CALENDAR} En Bilbao los festivos locales son el 31 de julio San Ignacio y el viernes de Aste Nagusia. Las oficinas municipales atienden con horario reducido en agosto.`;
    const donostia = `${BOILERPLATE_CALENDAR} En Donostia los festivos locales son el 20 de enero Dia de San Sebastian y el 31 de julio. El ayuntamiento publica tambien puentes escolares, ferias de barrio, horarios de bibliotecas, polideportivos, transporte urbano, atencion ciudadana y registros presenciales para todo el ejercicio anual vigente.`;
    const fpA = bodyShingleFingerprint(bilbao);
    const fpB = bodyShingleFingerprint(donostia);
    const overlap = jaccardOverlap(fpA, fpB);
    expect(overlap).not.toBeNull();
    expect(overlap!).toBeGreaterThanOrEqual(0.5);
  });

  it("measures low overlap on genuinely distinct catalog pages sharing a small header", () => {
    const sharedHeader =
      "Tests oficiales de oposiciones con explicacion verificada y modo simulacro cronometrado.";
    const enfermeria = `${sharedHeader} El periodo de incubacion del virus del Ebola oscila entre dos y veintiun dias segun la Organizacion Mundial de la Salud. En cuidados intensivos la monitorizacion hemodinamica invasiva requiere calibracion del transductor a nivel del eje flebostatico. La administracion segura de farmacos vasoactivos exige via venosa central, control estricto de tension arterial invasiva y vigilancia de signos de extravasacion tisular en cada turno asistencial.`;
    const celador = `${sharedHeader} El celador de quirofano colabora en el traslado y colocacion del paciente sobre la mesa quirurgica siguiendo siempre las indicaciones del equipo facultativo y de enfermeria. En el almacen general controla la recepcion de bultos, verifica albaranes de entrega, ordena el material fungible por fecha de caducidad y reparte pedidos internos hacia las unidades de hospitalizacion y consultas externas del hospital comarcal.`;
    const fpA = bodyShingleFingerprint(enfermeria);
    const fpB = bodyShingleFingerprint(celador);
    const overlap = jaccardOverlap(fpA, fpB);
    expect(overlap).not.toBeNull();
    expect(overlap!).toBeLessThan(0.25);
  });

  it("computes median and max overlap across sampled cluster siblings", () => {
    const base = `${BOILERPLATE_CALENDAR} Informacion oficial del calendario laboral anual.`;
    const a = bodyShingleFingerprint(`${base} Ciudad uno festivo local enero.`);
    const b = bodyShingleFingerprint(`${base} Ciudad dos festivo local mayo.`);
    const c = bodyShingleFingerprint(
      `${base} Ciudad tres festivo local agosto.`,
    );
    const res = clusterBodyOverlap([
      { url: "https://example.com/a", fingerprint: a },
      { url: "https://example.com/b", fingerprint: b },
      { url: "https://example.com/c", fingerprint: c },
    ]);
    expect(res).not.toBeNull();
    expect(res!.pairs).toBe(3);
    expect(res!.sampledPages).toBe(3);
    expect(res!.medianOverlap).toBeGreaterThanOrEqual(0.6);
  });
});
