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
        
        // Create temp directory if it doesn't exist
        if (!fs.existsSync(this.tempImageDir)) {
            fs.mkdirSync(this.tempImageDir);
        }
    }

    async downloadImage(url, filename) {
        try {
            const response = await axios.get(url, { responseType: 'stream' });
            const writer = fs.createWriteStream(filename);
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filename));
                writer.on('error', reject);
            });
        } catch (error) {
            console.error('Error downloading image:', error);
            return null;
        }
    }

    async createPDF(channelMessages, serverName) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFilename = `server_messages_${serverName}_${timestamp}.pdf`;
        const doc = new PDFDocument({ autoFirstPage: true, margin: 50 });
        
        doc.pipe(fs.createWriteStream(outputFilename));

        for (const [channelName, messages] of Object.entries(channelMessages)) {
            doc.addPage();
            doc.fontSize(16).font('Helvetica-Bold').text(`Channel: ${channelName}`, { underline: true });
            doc.moveDown();

            for (const msg of messages) {
                doc.fontSize(10).font('Helvetica-Bold')
                    .text(`[${msg.timestamp}] ${msg.author}`, { continued: false });
                
                doc.fontSize(12).font('Helvetica')
                    .text(msg.content || '[No content]');

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

            for (const [_, channel] of channels) {
                try {
                    console.log(`Scraping channel: ${channel.name}`);
                    const messages = [];
                    let lastId = null;
                    
                    while (true) {
                        const options = { limit: 99 };
                        if (lastId) options.before = lastId;
                        
                        const batch = await channel.messages.fetch(options);
                        if (batch.size === 0) break;
                        
                        for (const [_, message] of batch) {
                            const msgData = {
                                content: message.content,
                                author: message.author.tag,
                                timestamp: message.createdAt.toISOString()
                            };

                            // Handle attachments
                            for (const attachment of message.attachments.values()) {
                                if (/\.(jpg|jpeg|png|gif)$/i.test(attachment.name)) {
                                    const filename = path.join(this.tempImageDir, 
                                        `${channel.name}_${attachment.id}${path.extname(attachment.name)}`);
                                    const downloadedFile = await this.downloadImage(attachment.url, filename);
                                    if (downloadedFile) {
                                        msgData.imagePath = downloadedFile;
                                    }
                                }
                            }

                            messages.push(msgData);
                        }

                        lastId = batch.last().id;
                        await setTimeout(1000); // Wait 1 second between batches
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
                const pdfFile = await this.createPDF(channelMessages, guild.name);
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
            await this.scrapeServer(serverId);
            console.log('Scraping completed. Logging out...');
            this.client.destroy();
            rl.close();
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