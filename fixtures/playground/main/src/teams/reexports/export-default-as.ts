// The same binding as `export default store`, with a type assertion.
import store from '../internal/storage/store';
export default store as typeof store; // expect: internalReExport
