import type { ServiceModule } from "./types.js";
import { govData } from "./gov-data/index.js";
import { boi } from "./boi/index.js";
import { hebcal } from "./hebcal/index.js";
import { greenInvoice } from "./green-invoice/index.js";
import { ica } from "./ica/index.js";

/** Registration order = order tools appear in clients. */
export const services: ServiceModule[] = [govData, ica, boi, hebcal, greenInvoice];
