import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, DeleteCategoryQueryDto, RecolorCategoriesDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/category.dto';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.categoriesService.list(user.id);
  }

  @Get('aggregate')
  aggregate(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('isIncome') isIncome?: string,
  ) {
    return this.categoriesService.sumByHierarchy(
      user.id,
      { from: new Date(from), to: new Date(to) },
      isIncome === 'true',
    );
  }

  /**
   * Riallinea i colori alla palette del tema. Operazione massiva e non
   * annullabile: il frontend la mette dietro una conferma esplicita.
   */
  @Post('recolor')
  recolor(@CurrentUser() user: AuthUser, @Body() dto: RecolorCategoriesDto) {
    return this.categoriesService.recolorWithPalette(user.id, dto.palette);
  }

  @Patch('reorder')
  reorder(@CurrentUser() user: AuthUser, @Body() dto: ReorderCategoriesDto) {
    return this.categoriesService.reorder(user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.categoriesService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: DeleteCategoryQueryDto,
  ) {
    return this.categoriesService.remove(user.id, id, { reassignTo: query.reassignTo });
  }
}
