// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { labelForItem, labelForLot } from '../lib/labels';
import { LabelPreview } from './InventoryPanels';

afterEach(cleanup);

describe('permanent label preview and print content', () => {
  const itemLabel = labelForItem({
    product_display_name: 'Blastoise Base Set 2',
    scan_sku: 'RV-7K3F9Q2',
    item_public_id: 'RV-ITEM-ABC123',
  });
  const lotLabel = labelForLot({
    product_display_name: 'Evolving Skies Booster Box',
    lot_public_id: 'RV-C-0000001234',
    quantity: 6,
  });

  it.each(['compact', 'standard', 'sheet'])('keeps %s item and lot labels free of mutable locations', (size) => {
    const { container } = render(<LabelPreview labels={[itemLabel, lotLabel]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Label size'), { target: { value: size } });

    const printedLabels = container.querySelector('.rv-label-sheet');
    expect(printedLabels?.textContent).toContain('RV-ITEM-ABC123');
    expect(printedLabels?.textContent).toContain('RV-7K3F9Q2');
    expect(printedLabels?.textContent).toContain('RV-C-0000001234');
    expect(printedLabels?.textContent).toContain('Qty 6');
    expect(printedLabels?.textContent).not.toMatch(/Shelf A|S-A|Bin 2|BIN-2/);
    expect(screen.getByLabelText('Barcode for RV-7K3F9Q2')).toBeTruthy();
    expect(screen.getByLabelText('Barcode for RV-C-0000001234')).toBeTruthy();
  });
});
