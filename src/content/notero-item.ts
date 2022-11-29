import Notion from './notion';

const APA_STYLE = 'bibliography=http://www.zotero.org/styles/apa';

const PARENS_REGEX = /^\((.+)\)$/;

export default class NoteroItem {
  static NOTION_TAG_NAME = 'notion';

  private static formatCreatorName({ firstName, lastName }: Zotero.Creator) {
    return [lastName, firstName].filter((name) => name).join(', ');
  }

  private static getQuickCopyFormat(): string {
    const format = Zotero.Prefs.get('export.quickCopy.setting');

    if (typeof format === 'string' && format) {
      return format;
    }
    return APA_STYLE;
  }

  private readonly zoteroItem: Zotero.Item;
  private cachedCitations: Record<string, string | null> = {};

  public constructor(zoteroItem: Zotero.Item) {
    this.zoteroItem = zoteroItem;
  }

  public getAbstract(): string | null {
    return this.zoteroItem.getField('abstractNote') || null;
  }

  public getAuthors(): string[] {
    const primaryCreatorTypeID = Zotero.CreatorTypes.getPrimaryIDForType(
      this.zoteroItem.itemTypeID
    );

    return this.zoteroItem
      .getCreators()
      .filter(({ creatorTypeID }) => creatorTypeID === primaryCreatorTypeID)
      .map(NoteroItem.formatCreatorName);
  }

  public getDate(): string | null {
    return this.zoteroItem.getField('date') || null;
  }

  public getDOI(): string | null {
    const doi = this.zoteroItem.getField('DOI');
    return doi ? `https://doi.org/${doi}` : null;
  }

  public getEditors(): string[] {
    return this.zoteroItem
      .getCreators()
      .filter(
        ({ creatorTypeID }) =>
          Zotero.CreatorTypes.getName(creatorTypeID) === 'editor'
      )
      .map(NoteroItem.formatCreatorName);
  }

  public async getFilePath(): Promise<string | null> {
    const attachment = await this.zoteroItem.getBestAttachment();
    if (!attachment) return null;

    return (await attachment.getFilePathAsync()) || null;
  }

  private getCitation(
    format: string,
    inTextCitation: boolean
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const result = Zotero.QuickCopy.getContentFromItems(
        [this.zoteroItem],
        format,
        (obj, worked) => {
          resolve(worked ? obj.string.trim() : null);
        },
        inTextCitation
      );

      if (result === false) {
        resolve(null);
      } else if (result !== true) {
        resolve(result.text.trim());
      }
    });
  }

  private async getCachedCitation(
    format: string,
    inTextCitation: boolean
  ): Promise<string | null> {
    const cacheKey = `${format}-${String(inTextCitation)}`;

    if (this.cachedCitations[cacheKey] === undefined) {
      this.cachedCitations[cacheKey] = await this.getCitation(
        format,
        inTextCitation
      );
    }
    return this.cachedCitations[cacheKey];
  }

  public async getAuthorDateCitation(): Promise<string | null> {
    const citation = await this.getCachedCitation(APA_STYLE, true);
    return citation?.match(PARENS_REGEX)?.[1] || null;
  }

  public getFullCitation(): Promise<string | null> {
    return this.getCachedCitation(NoteroItem.getQuickCopyFormat(), false);
  }

  public getInTextCitation(): Promise<string | null> {
    return this.getCachedCitation(NoteroItem.getQuickCopyFormat(), true);
  }

  public getItemType(): string {
    return Zotero.ItemTypes.getLocalizedString(this.zoteroItem.itemTypeID);
  }

  public getShortTitle(): string | null {
    return this.zoteroItem.getField('shortTitle') || null;
  }

  public getTags(): string[] {
    return this.zoteroItem
      .getTags()
      .map(({ tag }) => tag)
      .filter((tag) => tag !== NoteroItem.NOTION_TAG_NAME);
  }

  public getTitle(): string {
    return this.zoteroItem.getDisplayTitle();
  }

  public getURL(): string | null {
    return this.zoteroItem.getField('url') || null;
  }

  public getYear(): number | null {
    const year = Number.parseInt(this.zoteroItem.getField('year') || '');
    return Number.isNaN(year) ? null : year;
  }

  public getZoteroURI(): string {
    return Zotero.URI.getItemURI(this.zoteroItem);
  }

  public getNotionLinkAttachments(): Zotero.Item[] {
    const attachmentIDs = this.zoteroItem
      .getAttachments(false)
      .slice()
      // Sort to get largest ID first
      .sort((a, b) => b - a);

    return Zotero.Items.get(attachmentIDs).filter((attachment) =>
      attachment.getField('url')?.startsWith(Notion.URL_PROTOCOL)
    );
  }

  public getNotionPageID(): string | undefined {
    const notionURL = this.getNotionLinkAttachments()[0]?.getField('url');
    return notionURL && Notion.getPageIDFromURL(notionURL);
  }

  public async saveNotionLinkAttachment(url: string): Promise<void> {
    const notionURL = Notion.convertWebURLToLocal(url);
    const attachments = this.getNotionLinkAttachments();

    if (attachments.length > 1) {
      const attachmentIDs = attachments.slice(1).map(({ id }) => id);
      await Zotero.Items.erase(attachmentIDs);
    }

    if (attachments.length > 0) {
      attachments[0].setField('url', notionURL);
      await attachments[0].saveTx();
    } else {
      await Zotero.Attachments.linkFromURL({
        parentItemID: this.zoteroItem.id,
        title: 'Notion',
        url: notionURL,
        saveOptions: {
          skipNotifier: true,
        },
      });
    }
  }

  public async saveNotionTag(): Promise<void> {
    this.zoteroItem.addTag(NoteroItem.NOTION_TAG_NAME);
    await this.zoteroItem.saveTx({ skipNotifier: true });
  }
}