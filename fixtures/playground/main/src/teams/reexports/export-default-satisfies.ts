// The same binding as `export default store`, with `satisfies`.
import store from '../internal/storage/store';
export default store satisfies object; // expect: internalReExport
