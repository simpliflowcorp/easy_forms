import { SandboxStoreState } from "../types";
import Form from "@/models/formModel";
import CustomView from "@/models/customViewModel";

// In-Memory isolated Sandbox Store for draft agent actions before final DB merge
class SandboxStoreManager {
  private stores: Map<string, SandboxStoreState> = new Map();

  public getStore(userId: string): SandboxStoreState {
    if (!this.stores.has(userId)) {
      this.stores.set(userId, {
        forms: {},
        customViews: {},
        queryResults: {},
      });
    }
    return this.stores.get(userId)!;
  }

  public resetStore(userId: string): void {
    this.stores.set(userId, {
      forms: {},
      customViews: {},
      queryResults: {},
    });
  }

  // Save isolated draft form
  public saveDraftForm(userId: string, formData: any): any {
    const store = this.getStore(userId);
    const draftId = formData.formId || `draft_form_${Date.now()}`;
    const draftForm = {
      ...formData,
      _id: draftId,
      formId: draftId,
      isSandboxDraft: true,
    };
    store.forms[draftId] = draftForm;
    return draftForm;
  }

  // Save isolated draft view
  public saveDraftView(userId: string, viewData: any): any {
    const store = this.getStore(userId);
    const draftId = viewData._id || `draft_view_${Date.now()}`;
    const draftView = {
      ...viewData,
      _id: draftId,
      isSandboxDraft: true,
    };
    store.customViews[draftId] = draftView;
    return draftView;
  }

  // Merge isolated sandbox drafts into production MongoDB
  public async mergeToProduction(userId: string): Promise<{ mergedForms: number; mergedViews: number }> {
    const store = this.getStore(userId);
    let mergedForms = 0;
    let mergedViews = 0;

    // Merge forms to production DB
    for (const draft of Object.values(store.forms)) {
      delete draft.isSandboxDraft;
      if (draft._id && String(draft._id).startsWith("draft_")) {
        delete draft._id;
      }
      await Form.create({ ...draft, user: userId });
      mergedForms++;
    }

    // Merge views to production DB
    for (const draft of Object.values(store.customViews)) {
      delete draft.isSandboxDraft;
      if (draft._id && String(draft._id).startsWith("draft_")) {
        delete draft._id;
      }
      await CustomView.create({ ...draft, user: userId });
      mergedViews++;
    }

    // Clear sandbox store after successful merge
    this.resetStore(userId);
    return { mergedForms, mergedViews };
  }
}

export const sandboxStore = new SandboxStoreManager();
