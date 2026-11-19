import './style.css';
import { mountCustomizer, type Personalization } from './customizer';
import { christmasPet } from './template';

const dialog = document.querySelector<HTMLDialogElement>('#cart-dialog')!;

// In the standalone demo, "Add to cart" just shows what would be attached to the order.
// In Shopify this becomes: upload printBlob -> POST /cart/add.js with line item properties.
function showCart(p: Personalization) {
  const props = {
    ...p.options,
    _template: p.templateId,
    _preview_url: '(uploaded preview URL in production)',
    _print_file_url: `(uploaded ${(p.printBlob.size / 1024 / 1024).toFixed(1)} MB PNG in production)`,
  };
  dialog.querySelector('img')!.src = p.previewDataUrl;
  dialog.querySelector('pre')!.textContent = JSON.stringify({ id: 'VARIANT_ID', quantity: 1, properties: props }, null, 2);
  dialog.showModal();
}

mountCustomizer(document.querySelector('#customizer')!, christmasPet, { onAddToCart: showCart });
