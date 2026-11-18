// Module augmentation changes the types of an internal module from outside teams/.
export {};
declare module '../teams/internal/rows' { // expect: internalImport
  interface Row {
    readonly billedAt: Date;
  }
}
