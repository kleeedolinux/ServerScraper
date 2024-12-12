import { Client } from 'discord.js-selfbot-v13';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { setTimeout } from 'timers/promises';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

class MessageScraper {
    constructor() {
        this.client = new Client();
        this.tempImageDir = path.join(__dirname, 'temp_images');
        this.iconDir = path.join(this.tempImageDir, 'icons');
        this.attachmentDir = path.join(this.tempImageDir, 'attachments');
        this.embedDir = path.join(this.tempImageDir, 'embeds');
        
        // Create all required directories
        [this.tempImageDir, this.iconDir, this.attachmentDir, this.embedDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    async downloadImage(url, filename) {
        try {
            // Clean the URL by removing query parameters but keep Discord's CDN parameters
            const cleanUrl = url.split('?')[0];
            const urlParams = url.includes('?') ? '?' + url.split('?')[1] : '';
            const finalUrl = cleanUrl + urlParams;
            
            // Clean the filename
            const cleanFilename = filename.replace(/[<>:"/\\|?*]/g, '_');
            
            const response = await axios.get(finalUrl, { 
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'image/*, */*'
                },
                validateStatus: status => status < 500, // Accept all status codes less than 500
                maxRedirects: 5,
                timeout: 10000 // 10 second timeout
            });
            
            // If response is not successful, return null
            if (response.status !== 200) {
                console.log(`Failed to download image (Status ${response.status}): ${finalUrl}`);
                return null;
            }

            const writer = fs.createWriteStream(cleanFilename);
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(cleanFilename));
                writer.on('error', (error) => {
                    console.error('Error writing file:', error);
                    fs.unlink(cleanFilename).catch(() => {}); // Clean up failed file
                    resolve(null);
                });
            });
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                console.log('Download timeout:', url);
            } else {
                console.error('Error downloading image:', error.message);
            }
            return null;
        }
    }

    async createPDF(channelMessages, serverName, serverInfo) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFilename = `server_messages_${serverName}_${timestamp}.pdf`;
        const doc = new PDFDocument({ autoFirstPage: true, margin: 50 });
        
        doc.pipe(fs.createWriteStream(outputFilename));

        // Add server information at the start
        doc.fontSize(20).font('Helvetica-Bold').text('Discord Server Archive', { align: 'center' });
        doc.moveDown();
        
        // Add server details
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text('Server Information:', { underline: true });
        doc.fontSize(12).font('Helvetica');
        doc.text(`Name: ${serverInfo.name}`);
        doc.text(`ID: ${serverInfo.id}`);
        doc.text(`Archive Date: ${new Date().toLocaleString()}`);
        
        // Add server icon if available
        if (serverInfo.iconURL) {
            try {
                const iconPath = path.join(this.iconDir, 'server_icon.png');
                await this.downloadImage(serverInfo.iconURL, iconPath);
                doc.image(iconPath, {
                    fit: [100, 100],
                    align: 'center'
                });
                fs.unlinkSync(iconPath); // Clean up icon file
            } catch (error) {
                doc.text('(Server icon could not be embedded)');
            }
        }
        
        doc.moveDown(2);
        doc.fontSize(14).font('Helvetica-Bold').text('Channel Contents:', { underline: true });
        doc.moveDown();

        // Rest of the channels and messages
        for (const [channelName, messages] of Object.entries(channelMessages)) {
            doc.addPage();
            doc.fontSize(16).font('Helvetica-Bold').text(`Channel: ${channelName}`, { underline: true });
            doc.moveDown();

            for (const msg of messages) {
                // Message header
                doc.fontSize(10).font('Helvetica-Bold')
                    .text(`[${msg.timestamp}] ${msg.author}`, { continued: false });
                
                // Message content
                if (msg.content) {
                    doc.fontSize(12).font('Helvetica')
                        .text(msg.content);
                }

                // Handle embeds
                if (msg.embeds && msg.embeds.length > 0) {
                    for (const embed of msg.embeds) {
                        doc.moveDown(0.5);
                        
                        // Embed border
                        doc.rect(doc.x, doc.y, 500, 2).fill('#202225');
                        doc.moveDown(0.5);

                        // Embed title
                        if (embed.title) {
                            doc.fontSize(14).font('Helvetica-Bold')
                                .text(embed.title, { link: embed.url });
                        }

                        // Embed author
                        if (embed.author) {
                            doc.fontSize(11).font('Helvetica')
                                .text(embed.author.name, { link: embed.author.url });
                        }

                        // Embed description
                        if (embed.description) {
                            doc.fontSize(12).font('Helvetica')
                                .text(embed.description);
                        }

                        // Embed fields
                        if (embed.fields && embed.fields.length > 0) {
                            doc.moveDown(0.5);
                            for (const field of embed.fields) {
                                doc.fontSize(11).font('Helvetica-Bold')
                                    .text(field.name);
                                doc.fontSize(11).font('Helvetica')
                                    .text(field.value);
                                doc.moveDown(0.5);
                            }
                        }

                        // Embed thumbnail
                        if (embed.thumbnailPath) {
                            try {
                                doc.image(embed.thumbnailPath, {
                                    fit: [150, 150],
                                    align: 'center'
                                });
                            } catch (error) {
                                doc.text('[Embed thumbnail could not be embedded]');
                            }
                        }

                        // Embed image
                        if (embed.imagePath) {
                            try {
                                doc.image(embed.imagePath, {
                                    fit: [500, 300],
                                    align: 'center'
                                });
                            } catch (error) {
                                doc.text('[Embed image could not be embedded]');
                            }
                        }

                        // Embed footer
                        if (embed.footer) {
                            doc.moveDown(0.5);
                            doc.fontSize(10).font('Helvetica')
                                .text(embed.footer.text);
                        }

                        doc.moveDown();
                    }
                }

                // Message attachments
                if (msg.imagePath) {
                    try {
                        doc.image(msg.imagePath, {
                            fit: [500, 300],
                            align: 'center'
                        });
                    } catch (error) {
                        doc.text('[Image could not be embedded]');
                    }
                }
                doc.moveDown();
            }
        }

        doc.end();
        return outputFilename;
    }

    async scrapeServer(serverId) {
        try {
            const guild = await this.client.guilds.fetch(serverId);
            const channels = guild.channels.cache.filter(channel => channel.type === 'GUILD_TEXT');
            const channelMessages = {};

            // Prepare server info for PDF
            const serverInfo = {
                name: guild.name,
                id: guild.id,
                iconURL: guild.iconURL()
            };

            for (const [_, channel] of channels) {
                try {
                    console.log(`Scraping channel: ${channel.name}`);
                    let messages = [];
                    let lastId = null;
                    
                    // First, get the oldest messages
                    while (true) {
                        const options = { limit: 99 };
                        if (lastId) options.before = lastId;
                        
                        const batch = await channel.messages.fetch(options);
                        if (batch.size === 0) break;
                        
                        // Process messages in this batch
                        const batchMessages = Array.from(batch.values()).map(message => ({
                            content: message.content,
                            author: message.author.tag,
                            timestamp: message.createdAt.toISOString(),
                            embeds: [],
                            id: message.id,
                            createdTimestamp: message.createdTimestamp
                        }));

                        messages = messages.concat(batchMessages);
                        lastId = batch.last().id;
                        await setTimeout(1000);
                    }

                    // Sort messages by timestamp (oldest first)
                    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

                    // Now process attachments and embeds for the sorted messages
                    for (const msgData of messages) {
                        const message = await channel.messages.fetch(msgData.id);

                        // Handle embeds
                        for (const embed of message.embeds) {
                            const embedData = {
                                title: embed.title,
                                description: embed.description,
                                url: embed.url,
                                color: embed.color,
                                timestamp: embed.timestamp,
                                fields: embed.fields.map(field => ({
                                    name: field.name,
                                    value: field.value,
                                    inline: field.inline
                                })),
                                author: embed.author ? {
                                    name: embed.author.name,
                                    url: embed.author.url,
                                    iconURL: embed.author.iconURL
                                } : null,
                                footer: embed.footer ? {
                                    text: embed.footer.text,
                                    iconURL: embed.footer.iconURL
                                } : null
                            };

                            // Handle embed thumbnail
                            if (embed.thumbnail) {
                                const ext = path.extname(embed.thumbnail.url.split('?')[0]) || '.png';
                                const filename = path.join(this.embedDir, 
                                    `${channel.name}_${message.id}_thumb${ext}`);
                                const downloadedFile = await this.downloadImage(embed.thumbnail.url, filename);
                                if (downloadedFile) {
                                    embedData.thumbnailPath = downloadedFile;
                                }
                            }

                            // Handle embed image
                            if (embed.image) {
                                try {
                                    const ext = path.extname(embed.image.url.split('?')[0]) || '.png';
                                    const filename = path.join(this.embedDir, 
                                        `${channel.name}_${message.id}_embed${ext}`);
                                    const downloadedFile = await this.downloadImage(embed.image.url, filename);
                                    if (downloadedFile) {
                                        embedData.imagePath = downloadedFile;
                                    }
                                } catch (error) {
                                    console.error('Failed to process embed image:', error.message);
                                }
                            }

                            msgData.embeds.push(embedData);
                        }

                        // Handle attachments
                        for (const attachment of message.attachments.values()) {
                            if (/\.(jpg|jpeg|png|gif|webp)$/i.test(attachment.name)) {
                                try {
                                    const safeFilename = attachment.name.replace(/[<>:"/\\|?*]/g, '_');
                                    const filename = path.join(this.attachmentDir, 
                                        `${channel.name}_${attachment.id}_${safeFilename}`);
                                    const downloadedFile = await this.downloadImage(attachment.url, filename);
                                    if (downloadedFile) {
                                        msgData.imagePath = downloadedFile;
                                    }
                                } catch (error) {
                                    console.error(`Failed to process attachment: ${attachment.name}`, error.message);
                                    continue;
                                }
                            }
                        }
                    }

                    if (messages.length > 0) {
                        channelMessages[channel.name] = messages;
                    }

                } catch (error) {
                    console.error(`Error in channel ${channel.name}:`, error);
                    continue;
                }
            }

            if (Object.keys(channelMessages).length > 0) {
                const pdfFile = await this.createPDF(channelMessages, guild.name, serverInfo);
                console.log(`PDF created: ${pdfFile}`);

                // Cleanup temp images
                for (const messages of Object.values(channelMessages)) {
                    for (const msg of messages) {
                        if (msg.imagePath) {
                            try {
                                fs.unlinkSync(msg.imagePath);
                            } catch (error) {
                                console.error('Error deleting temp image:', error);
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error scraping server:', error);
        }
    }

    async start() {
        const serverId = await question('Please enter the server ID to scrape: ');
        
        this.client.on('ready', async () => {
            console.log(`Logged in as ${this.client.user.tag}`);
            
            try {
                const guild = await this.client.guilds.fetch(serverId);
                console.log('\n=== Starting Server Scrape ===');
                console.log(`Server Name: ${guild.name}`);
                console.log(`Server ID: ${guild.id}`);
                console.log(`Server Icon: ${guild.iconURL() || 'No icon'}`);
                console.log('===========================\n');
                
                await this.scrapeServer(serverId);
                console.log('Scraping completed. Logging out...');
                this.client.destroy();
                rl.close();
            } catch (error) {
                console.error('Error fetching server:', error);
                this.client.destroy();
                rl.close();
            }
        });

        const token = process.env.DISCORD_TOKEN;
        if (!token) {
            console.error('No Discord token found in environment variables!');
            rl.close();
            return;
        }

        try {
            await this.client.login(token);
        } catch (error) {
            console.error('Failed to login:', error);
            rl.close();
        }
    }
}

// Usage
const scraper = new MessageScraper();
scraper.start(); 