import { Router } from 'express';
import { syncCatalogMock, getProducts } from './catalog';

export const catalogRoutes = Router();

catalogRoutes.post('/sync', (req, res) => {
  try {
    const result = syncCatalogMock();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sync catalog' });
  }
});

catalogRoutes.get('/', (req, res) => {
  try {
    const products = getProducts();
    res.json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get catalog' });
  }
});
