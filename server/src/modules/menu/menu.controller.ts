import type { Request, Response, NextFunction } from 'express';
import * as service from './menu.service.js';
import { Unauthorized } from '../../utils/errors.js';

/**
 * Thin controllers. Responsibilities:
 *   - Pull auth and request meta off the Request.
 *   - Call the service.
 *   - Serialize the response.
 * No business logic, no validation (middleware does it), no DB access.
 */

function authOrThrow(req: Request) {
  if (!req.auth) throw Unauthorized();
  return req.auth;
}

function meta(req: Request) {
  return { requestId: req.requestId, ipAddress: req.ip };
}

// ---- Categories -----------------------------------------------------------

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await service.createCategory(authOrThrow(req), req.body, meta(req));
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
}

export async function listCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { includeInactive?: string };
    const categories = await service.listCategories(authOrThrow(req), {
      includeInactive: q.includeInactive === 'true',
    });
    res.json({ data: categories });
  } catch (err) {
    next(err);
  }
}

export async function getCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await service.getCategory(authOrThrow(req), (req.params as { id: string }).id);
    res.json(category);
  } catch (err) {
    next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await service.updateCategory(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(category);
  } catch (err) {
    next(err);
  }
}

export async function deactivateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const category = await service.deactivateCategory(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.json(category);
  } catch (err) {
    next(err);
  }
}

// ---- Items ----------------------------------------------------------------

export async function createItem(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await service.createItem(authOrThrow(req), req.body, meta(req));
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

export async function listItems(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { categoryId?: string; includeInactive?: string };
    const items = await service.listItems(authOrThrow(req), {
      categoryId: q.categoryId,
      includeInactive: q.includeInactive === 'true',
    });
    res.json({ data: items });
  } catch (err) {
    next(err);
  }
}

export async function getItem(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await service.getItem(authOrThrow(req), (req.params as { id: string }).id);
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function updateItem(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await service.updateItem(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function deactivateItem(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await service.deactivateItem(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.json(item);
  } catch (err) {
    next(err);
  }
}

export async function setItemInStock(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { inStock: boolean };
    const item = await service.setItemInStock(
      authOrThrow(req),
      (req.params as { id: string }).id,
      body.inStock,
      meta(req),
    );
    res.json(item);
  } catch (err) {
    next(err);
  }
}

// ---- Addons ---------------------------------------------------------------

export async function createAddon(req: Request, res: Response, next: NextFunction) {
  try {
    const addon = await service.createAddon(authOrThrow(req), req.body, meta(req));
    res.status(201).json(addon);
  } catch (err) {
    next(err);
  }
}

export async function listAddons(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { includeInactive?: string };
    const addons = await service.listAddons(authOrThrow(req), {
      includeInactive: q.includeInactive === 'true',
    });
    res.json({ data: addons });
  } catch (err) {
    next(err);
  }
}

export async function getAddon(req: Request, res: Response, next: NextFunction) {
  try {
    const addon = await service.getAddon(authOrThrow(req), (req.params as { id: string }).id);
    res.json(addon);
  } catch (err) {
    next(err);
  }
}

export async function updateAddon(req: Request, res: Response, next: NextFunction) {
  try {
    const addon = await service.updateAddon(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(addon);
  } catch (err) {
    next(err);
  }
}

export async function deactivateAddon(req: Request, res: Response, next: NextFunction) {
  try {
    const addon = await service.deactivateAddon(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.json(addon);
  } catch (err) {
    next(err);
  }
}

// ---- Addon Groups ---------------------------------------------------------

export async function createAddonGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const group = await service.createAddonGroup(authOrThrow(req), req.body, meta(req));
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
}

export async function listAddonGroups(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as { includeInactive?: string };
    const groups = await service.listAddonGroups(authOrThrow(req), {
      includeInactive: q.includeInactive === 'true',
    });
    res.json({ data: groups });
  } catch (err) {
    next(err);
  }
}

export async function getAddonGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const group = await service.getAddonGroup(authOrThrow(req), (req.params as { id: string }).id);
    res.json(group);
  } catch (err) {
    next(err);
  }
}

export async function updateAddonGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const group = await service.updateAddonGroup(
      authOrThrow(req),
      (req.params as { id: string }).id,
      req.body,
      meta(req),
    );
    res.json(group);
  } catch (err) {
    next(err);
  }
}

export async function deactivateAddonGroup(req: Request, res: Response, next: NextFunction) {
  try {
    const group = await service.deactivateAddonGroup(
      authOrThrow(req),
      (req.params as { id: string }).id,
      meta(req),
    );
    res.json(group);
  } catch (err) {
    next(err);
  }
}

// ---- Service menu (POS) ---------------------------------------------------

export async function getServiceMenu(req: Request, res: Response, next: NextFunction) {
  try {
    const menu = await service.getServiceMenu(authOrThrow(req));
    res.json({ data: menu });
  } catch (err) {
    next(err);
  }
}
