import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { AppComponent } from './app/app.component';
import { importProvidersFrom } from '@angular/core';
import {
  LucideAngularModule, Bot, Zap, Box, CheckCircle, AlertCircle, User,
  Trash2, Copy, Settings, Plus, Code, Network, Database, Shield,
  Square, BarChart2, Users, Share2, Link, Bell, Download, Send,
  File, Lightbulb, LayoutGrid, XCircle, FileText, RotateCcw,
  Menu, ChevronLeft, Sun, Moon,
  Map as MapIcon, Scale, TriangleAlert, Palette, ArrowRight
} from 'lucide-angular';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideAnimationsAsync(),
    importProvidersFrom(
      LucideAngularModule.pick({
        Bot, Zap, Box, CheckCircle, AlertCircle, User,
        Trash2, Copy, Settings, Plus, Code, Network, Database, Shield,
        Square, BarChart2, Users, Share2, Link, Bell, Download, Send,
        File, Lightbulb, LayoutGrid, XCircle, FileText, RotateCcw,
        Menu, ChevronLeft, Sun, Moon,
        Map: MapIcon, Scale, TriangleAlert, Palette, ArrowRight
      })
    )
  ]
}).catch(err => console.error(err));

