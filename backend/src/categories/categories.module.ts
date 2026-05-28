import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { CategorySharingService } from './category-sharing.service';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, CategorySharingService],
  exports: [CategoriesService, CategorySharingService],
})
export class CategoriesModule {}
