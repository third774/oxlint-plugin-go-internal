// The same binding as `export default store`, in parentheses.
import store from '../internal/storage/store';
export default (store); // expect: internalReExport
