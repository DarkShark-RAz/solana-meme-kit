declare module "jito-ts/dist/sdk/block-engine/types" {
  export class Bundle {
    constructor(transactions: any[], maxSize: number);
  }
}

declare module "jito-ts/dist/sdk/block-engine/searcher" {
  export function searcherClient(...args: any[]): any;
}
